from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.db import get_session
from kall.models import (
    CoverLetterChange,
    CoverLetterProposal,
    DocumentArtifact,
    GeneratedDocument,
    KeywordCoverageReport,
    TailoringProposal,
    User,
)
from kall.services.documents import (
    finalize_cover_letter,
    generate_resume_documents,
    propose_cover_letter,
    review_cover_letter_change,
)
from kall.services.storage import get_storage

router = APIRouter(tags=["documents"])


class GenerateResumeRequest(BaseModel):
    template_key: str = "standard"


class CoverLetterRequest(BaseModel):
    emphasis: str = "balanced"
    tone: str = "formal"
    length: str = "standard"
    company_interest_notes: str | None = None


class ReviewCoverLetterRequest(BaseModel):
    decision: str
    edited_text: str | None = None


def _owned_tailoring(session: Session, proposal_id: int, user_id: int) -> TailoringProposal:
    proposal = session.get(TailoringProposal, proposal_id)
    if not proposal or proposal.user_id != user_id:
        raise HTTPException(404, "Tailoring proposal not found")
    return proposal


@router.post("/tailoring/{proposal_id}/documents", response_model=GeneratedDocument)
def generate_documents(
    proposal_id: int,
    payload: GenerateResumeRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> GeneratedDocument:
    proposal = _owned_tailoring(session, proposal_id, current_user.id)
    try:
        return generate_resume_documents(session, proposal, payload.template_key)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/documents/{document_id}")
def get_document(
    document_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    document = session.get(GeneratedDocument, document_id)
    if not document or document.user_id != current_user.id:
        raise HTTPException(404, "Document not found")
    artifacts = list(
        session.exec(
            select(DocumentArtifact).where(DocumentArtifact.generated_document_id == document.id)
        )
    )
    coverage = session.exec(
        select(KeywordCoverageReport).where(
            KeywordCoverageReport.generated_document_id == document.id
        )
    ).first()
    return {"document": document, "artifacts": artifacts, "coverage": coverage}


@router.get("/documents/{document_id}/download/{file_format}")
def download_document(
    document_id: int,
    file_format: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Response:
    document = session.get(GeneratedDocument, document_id)
    if not document or document.user_id != current_user.id:
        raise HTTPException(404, "Document not found")
    artifact = session.exec(
        select(DocumentArtifact).where(
            DocumentArtifact.generated_document_id == document.id,
            DocumentArtifact.format == file_format,
        )
    ).first()
    storage = get_storage()
    if not artifact or not storage.exists(artifact.file_path):
        raise HTTPException(404, "Document artifact not found")
    return Response(
        content=storage.read(artifact.file_path),
        media_type=artifact.mime_type,
        headers={
            "Content-Disposition": f'attachment; filename="kall-{document.document_type}-{document.id}.{artifact.format}"'
        },
    )


@router.post("/tailoring/{proposal_id}/cover-letter", response_model=CoverLetterProposal)
def create_cover_letter(
    proposal_id: int,
    payload: CoverLetterRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CoverLetterProposal:
    proposal = _owned_tailoring(session, proposal_id, current_user.id)
    try:
        return propose_cover_letter(
            session,
            proposal,
            payload.emphasis,
            payload.tone,
            payload.length,
            payload.company_interest_notes,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/cover-letters/{proposal_id}")
def get_cover_letter(
    proposal_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    proposal = session.get(CoverLetterProposal, proposal_id)
    if not proposal or proposal.user_id != current_user.id:
        raise HTTPException(404, "Cover letter not found")
    changes = list(
        session.exec(
            select(CoverLetterChange)
            .where(CoverLetterChange.proposal_id == proposal.id)
            .order_by(CoverLetterChange.position)
        )
    )
    return {"proposal": proposal, "changes": changes}


@router.put("/cover-letter-changes/{change_id}", response_model=CoverLetterChange)
def review_cover_letter(
    change_id: int,
    payload: ReviewCoverLetterRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CoverLetterChange:
    change = session.get(CoverLetterChange, change_id)
    proposal = session.get(CoverLetterProposal, change.proposal_id) if change else None
    if not change or not proposal or proposal.user_id != current_user.id:
        raise HTTPException(404, "Cover letter change not found")
    try:
        return review_cover_letter_change(session, change, payload.decision, payload.edited_text)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/cover-letters/{proposal_id}/finalize", response_model=CoverLetterProposal)
def finalize_letter(
    proposal_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CoverLetterProposal:
    proposal = session.get(CoverLetterProposal, proposal_id)
    if not proposal or proposal.user_id != current_user.id:
        raise HTTPException(404, "Cover letter not found")
    try:
        return finalize_cover_letter(session, proposal)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
