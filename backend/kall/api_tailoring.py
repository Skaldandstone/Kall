from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.db import get_session
from kall.models import Job, TailoringChange, TailoringProposal, User
from kall.services.resume import reflow_extracted_text
from kall.services.tailoring import create_tailoring_proposal, finalize_proposal, review_change

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
