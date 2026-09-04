from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.db import get_session
from kall.models import Application, ApplicationAnswer, ApplicationReview, ScreeningQuestion, User
from kall.services.application_review import approve_review, build_review, calculate_readiness

router = APIRouter(tags=["application-review"])


class AnswerDecision(BaseModel):
    value: str | None = None
    value_json: dict[str, Any] = Field(default_factory=dict)
    decision: str


class ReviewConfirmation(BaseModel):
    documents_confirmed: bool = False
    answers_confirmed: bool = False
    sensitive_fields_confirmed: bool = False
    attestations_confirmed: bool = False


class GeneratedDocumentLinks(BaseModel):
    cover_letter_proposal_id: int | None = None
    generated_document_id: int | None = None


def owned_application(session: Session, user: User, application_id: int) -> Application:
    application = session.get(Application, application_id)
    if not application or application.user_id != user.id:
        raise HTTPException(404, "Application not found")
    return application


@router.get("/applications/{application_id}", response_model=Application)
def get_application(application_id: int, user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> Application:
    return owned_application(session, user, application_id)


@router.patch("/applications/{application_id}/generated-documents", response_model=Application)
def link_generated_documents(
    application_id: int,
    payload: GeneratedDocumentLinks,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Application:
    """Records the cover letter proposal / rendered document created for this
    application through the generic /tailoring and /documents endpoints, so
    the review UI can find them again after a reload -- those endpoints have
    no notion of "application" themselves.
    """
    application = owned_application(session, user, application_id)
    application.prepared_payload = {
        **application.prepared_payload,
        **payload.model_dump(exclude_unset=True),
    }
    session.add(application)
    session.commit()
    session.refresh(application)
    return application


@router.post("/applications/{application_id}/review", response_model=ApplicationReview)
def create_review(application_id: int, user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> ApplicationReview:
    return build_review(session, owned_application(session, user, application_id))


@router.get("/applications/{application_id}/review")
def get_review(application_id: int, user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict:
    application = owned_application(session, user, application_id)
    review = build_review(session, application)
    questions = list(session.exec(select(ScreeningQuestion).where(ScreeningQuestion.application_id == application.id)))
    answers = list(session.exec(select(ApplicationAnswer).where(ApplicationAnswer.application_id == application.id)))
    calculate_readiness(session, application, review)
    return {"application": application, "review": review, "questions": questions, "answers": answers}


@router.put("/applications/{application_id}/answers/{answer_id}", response_model=ApplicationAnswer)
def decide_answer(application_id: int, answer_id: int, payload: AnswerDecision, user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> ApplicationAnswer:
    application = owned_application(session, user, application_id)
    answer = session.get(ApplicationAnswer, answer_id)
    if not answer or answer.application_id != application.id:
        raise HTTPException(404, "Answer not found")
    if payload.decision not in {"accepted", "edited", "rejected"}:
        raise HTTPException(422, "Invalid decision")
    answer.value = payload.value
    answer.value_json = payload.value_json
    answer.status = payload.decision
    answer.source = "user" if payload.decision == "edited" else answer.source
    answer.reviewed_at = datetime.utcnow()
    session.add(answer)
    session.commit()
    session.refresh(answer)
    return answer


@router.put("/applications/{application_id}/review", response_model=ApplicationReview)
def confirm_review(application_id: int, payload: ReviewConfirmation, user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> ApplicationReview:
    application = owned_application(session, user, application_id)
    review = build_review(session, application)
    for field, value in payload.model_dump().items():
        setattr(review, field, value)
    session.add(review)
    session.commit()
    calculate_readiness(session, application, review)
    return review


@router.post("/applications/{application_id}/review/approve", response_model=ApplicationReview)
def approve(application_id: int, user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> ApplicationReview:
    application = owned_application(session, user, application_id)
    review = build_review(session, application)
    try:
        return approve_review(session, application, review)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
