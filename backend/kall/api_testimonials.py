import hashlib
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.db import get_session
from kall.models import Application, ApplicationTestimonial, Testimonial, TestimonialRequest, User
from kall.security import encrypt_sensitive

router = APIRouter(tags=["testimonials"])


class RequestCreate(BaseModel):
    recipient_name: str
    recipient_email: EmailStr
    relationship: str
    request_type: str = "testimonial"
    personal_message: str | None = None


class Submission(BaseModel):
    token: str
    author_name: str
    author_title: str | None = None
    author_company: str | None = None
    relationship: str
    body: str
    permission_granted: bool


class VisibilityUpdate(BaseModel):
    status: str
    include_on_profile: bool = False
    include_in_applications: bool = False


class Withdrawal(BaseModel):
    token: str
    reason: str | None = None


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@router.post("/testimonials/requests")
def create_request(payload: RequestCreate, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    token = secrets.token_urlsafe(32)
    request = TestimonialRequest(
        user_id=user.id,
        recipient_name=payload.recipient_name,
        recipient_email_encrypted=encrypt_sensitive(str(payload.recipient_email)),
        relationship=payload.relationship,
        request_type=payload.request_type,
        personal_message=payload.personal_message,
        token_hash=token_hash(token),
        expires_at=datetime.utcnow() + timedelta(days=30),
    )
    session.add(request)
    session.commit()
    session.refresh(request)
    return {"request": request, "invitation_token": token}


@router.delete("/testimonials/requests/{request_id}")
def revoke_request(request_id: int, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    request = session.get(TestimonialRequest, request_id)
    if not request or request.user_id != user.id:
        raise HTTPException(404, "Request not found")
    if request.status == "completed":
        raise HTTPException(422, "Completed requests cannot be revoked")
    request.status = "revoked"
    request.revoked_at = datetime.utcnow()
    session.add(request)
    session.commit()
    return {"status": "revoked"}


@router.post("/testimonials/submit", response_model=Testimonial)
def submit(payload: Submission, session: Session = Depends(get_session)):
    request = session.exec(select(TestimonialRequest).where(TestimonialRequest.token_hash == token_hash(payload.token))).first()
    if not request or request.status != "pending" or (request.expires_at and request.expires_at < datetime.utcnow()):
        raise HTTPException(404, "Invitation is invalid or expired")
    testimonial = Testimonial(
        user_id=request.user_id,
        request_id=request.id,
        author_name=payload.author_name,
        author_title=payload.author_title,
        author_company=payload.author_company,
        relationship=payload.relationship,
        body=payload.body,
        verified_via_request=True,
        permission_granted=payload.permission_granted,
    )
    request.status = "completed"
    request.completed_at = datetime.utcnow()
    session.add(testimonial)
    session.add(request)
    session.commit()
    session.refresh(testimonial)
    return testimonial


@router.post("/testimonials/withdraw")
def withdraw(payload: Withdrawal, session: Session = Depends(get_session)):
    request = session.exec(select(TestimonialRequest).where(TestimonialRequest.token_hash == token_hash(payload.token))).first()
    if not request or request.status != "completed":
        raise HTTPException(404, "Completed invitation not found")
    testimonial = session.exec(select(Testimonial).where(Testimonial.request_id == request.id)).first()
    if not testimonial:
        raise HTTPException(404, "Testimonial not found")
    testimonial.status = "withdrawn"
    testimonial.include_on_profile = False
    testimonial.include_in_applications = False
    testimonial.permission_granted = False
    testimonial.withdrawn_at = datetime.utcnow()
    testimonial.withdrawal_reason = payload.reason
    session.add(testimonial)
    session.commit()
    return {"status": "withdrawn"}


@router.get("/testimonials")
def list_testimonials(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    return list(session.exec(select(Testimonial).where(Testimonial.user_id == user.id)))


@router.get("/testimonials/profile-card")
def profile_card_testimonials(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    return list(session.exec(select(Testimonial).where(
        Testimonial.user_id == user.id,
        Testimonial.status == "approved",
        Testimonial.permission_granted,
        Testimonial.include_on_profile,
    )))


@router.put("/testimonials/{testimonial_id}", response_model=Testimonial)
def moderate(testimonial_id: int, payload: VisibilityUpdate, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    item = session.get(Testimonial, testimonial_id)
    if not item or item.user_id != user.id:
        raise HTTPException(404, "Testimonial not found")
    if item.status == "withdrawn":
        raise HTTPException(422, "Withdrawn testimonials cannot be republished")
    if payload.status not in {"approved", "rejected", "pending_review"}:
        raise HTTPException(422, "Invalid status")
    if payload.include_on_profile or payload.include_in_applications:
        if not item.permission_granted:
            raise HTTPException(422, "Author permission is required")
        # include_in_application() below already refuses anything but an
        # approved testimonial -- this enforces the same rule at the moment
        # visibility is turned on, rather than trusting every future caller
        # to always send status and include_on_profile together correctly.
        # Only today's one caller (ReferencesTab.tsx) does that; nothing
        # stops a different one from setting include_on_profile=True on a
        # testimonial still pending_review, which career_page.py's own
        # public-page filter would then have no reason to exclude.
        if payload.status != "approved":
            raise HTTPException(422, "Only an approved testimonial can be shown")
    item.status = payload.status
    item.include_on_profile = payload.include_on_profile
    item.include_in_applications = payload.include_in_applications
    item.approved_at = datetime.utcnow() if payload.status == "approved" else None
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@router.post("/applications/{application_id}/testimonials/{testimonial_id}")
def include_in_application(application_id: int, testimonial_id: int, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    application = session.get(Application, application_id)
    item = session.get(Testimonial, testimonial_id)
    if not application or application.user_id != user.id or not item or item.user_id != user.id:
        raise HTTPException(404, "Record not found")
    if item.status != "approved" or not item.include_in_applications or not item.permission_granted:
        raise HTTPException(422, "Testimonial is not approved for applications")
    existing = session.exec(select(ApplicationTestimonial).where(
        ApplicationTestimonial.application_id == application_id,
        ApplicationTestimonial.testimonial_id == testimonial_id,
    )).first()
    if existing:
        return existing
    link = ApplicationTestimonial(application_id=application_id, testimonial_id=testimonial_id, user_id=user.id)
    session.add(link)
    session.commit()
    session.refresh(link)
    return link


@router.get("/applications/{application_id}/testimonials")
def application_testimonials(application_id: int, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    application = session.get(Application, application_id)
    if not application or application.user_id != user.id:
        raise HTTPException(404, "Application not found")
    links = list(session.exec(select(ApplicationTestimonial).where(ApplicationTestimonial.application_id == application_id)))
    ids = [link.testimonial_id for link in links]
    if not ids:
        return []
    items = list(session.exec(select(Testimonial).where(Testimonial.id.in_(ids))))
    return [item for item in items if item.status == "approved" and item.permission_granted]
