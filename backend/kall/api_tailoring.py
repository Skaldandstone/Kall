from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.db import get_session
from kall.models import GeneratedDocument, Job, TailoringChange, TailoringProposal, User
from kall.services.resume import reflow_extracted_text
from kall.services.tailoring import (
    create_tailoring_proposal,
    finalize_proposal,
    review_all,
    review_change,
)


class ReviewAllRequest(BaseModel):
    status: str
    section_prefix: str | None = None

router = APIRouter(prefix="/tailoring", tags=["tailoring"])


class CreateProposalRequest(BaseModel):
    job_id: int
    professional_profile_id: int


class ReviewChangeRequest(BaseModel):
    status: str
    edited_text: str | None = None


@router.post("/proposals", response_model=TailoringProposal)
def create_proposal(
    payload: CreateProposalRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> TailoringProposal:
    job = session.get(Job, payload.job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    try:
        return create_tailoring_proposal(session, current_user.id, job, payload.professional_profile_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/proposals")
def list_proposals(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[dict]:
    """Every proposal this user owns, named by the job it was built for.

    A proposal only ever meant something as "the tailored resume for that
    posting", but the only handle the web UI had for one was its primary
    key, so the person was asked to read a number off one tab and type it
    into another. This returns the name, the review progress, and whether
    files already exist, which is everything a picker needs.
    """
    proposals = list(
        session.exec(
            select(TailoringProposal)
            .where(TailoringProposal.user_id == current_user.id)
            .order_by(TailoringProposal.id.desc())
        )
    )
    if not proposals:
        return []

    proposal_ids = [proposal.id for proposal in proposals]
    changes = list(session.exec(select(TailoringChange).where(TailoringChange.proposal_id.in_(proposal_ids))))
    jobs = {
        job.id: job
        for job in session.exec(select(Job).where(Job.id.in_({proposal.job_id for proposal in proposals})))
    }
    documented = set(
        session.exec(
            select(GeneratedDocument.proposal_id).where(GeneratedDocument.proposal_id.in_(proposal_ids))
        )
    )

    rows = []
    for proposal in proposals:
        own = [change for change in changes if change.proposal_id == proposal.id]
        job = jobs.get(proposal.job_id)
        rows.append(
            {
                "id": proposal.id,
                "status": proposal.status,
                "job_title": job.title if job else "Saved job",
                "company": job.company if job else None,
                "job_url": job.url if job else None,
                "change_count": len(own),
                "pending_count": len([change for change in own if change.status == "pending"]),
                "has_document": proposal.id in documented,
                "created_at": proposal.created_at,
                "finalized_at": proposal.finalized_at,
            }
        )
    return rows


@router.get("/proposals/{proposal_id}")
def get_proposal(
    proposal_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    proposal = session.get(TailoringProposal, proposal_id)
    if not proposal or proposal.user_id != current_user.id:
        raise HTTPException(404, "Proposal not found")
    changes = list(session.exec(select(TailoringChange).where(TailoringChange.proposal_id == proposal.id)))
    # Proposals built from a resume stored before word-per-line extraction
    # was reflowed still carry that text. Repair them on read: the reflow
    # changes whitespace only, so every immutable token is untouched and a
    # pending decision stays valid.
    repaired = False
    for change in changes:
        if change.status != "pending":
            continue
        original = reflow_extracted_text(change.original_text)
        proposed = reflow_extracted_text(change.proposed_text)
        if original != change.original_text or proposed != change.proposed_text:
            change.original_text = original
            change.proposed_text = proposed
            session.add(change)
            repaired = True
    if repaired:
        session.commit()
        for change in changes:
            session.refresh(change)
    return {"proposal": proposal, "changes": changes}


@router.patch("/changes/{change_id}", response_model=TailoringChange)
def decide_change(
    change_id: int,
    payload: ReviewChangeRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> TailoringChange:
    change = session.get(TailoringChange, change_id)
    proposal = session.get(TailoringProposal, change.proposal_id) if change else None
    if not change or not proposal or proposal.user_id != current_user.id:
        raise HTTPException(404, "Tailoring change not found")
    try:
        return review_change(session, change, payload.status, payload.edited_text)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/proposals/{proposal_id}/review-all")
def review_every_change(
    proposal_id: int,
    payload: ReviewAllRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    proposal = session.get(TailoringProposal, proposal_id)
    if not proposal or proposal.user_id != current_user.id:
        raise HTTPException(404, "Proposal not found")
    try:
        touched = review_all(session, proposal, payload.status, payload.section_prefix)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"reviewed": len(touched), "changes": touched}


@router.post("/proposals/{proposal_id}/finalize", response_model=TailoringProposal)
def finalize(
    proposal_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> TailoringProposal:
    proposal = session.get(TailoringProposal, proposal_id)
    if not proposal or proposal.user_id != current_user.id:
        raise HTTPException(404, "Proposal not found")
    try:
        return finalize_proposal(session, proposal)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
