from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.db import get_session
from kall.models import (
    Application,
    CoverLetterChange,
    CoverLetterProposal,
    GeneratedDocument,
    Job,
    KeywordCoverageReport,
    TailoringProposal,
    User,
)
from kall.services import quota
from kall.services.ats_check import ats_report
from kall.services.documents import (
    ARTIFACT_FORMATS,
    RESUME_TEMPLATE_KEYS,
    document_preview_png,
    ensure_artifact,
    ensure_preview,
    finalize_cover_letter,
    generate_resume_documents,
    offered_artifacts,
    propose_cover_letter,
    review_cover_letter_change,
    save_document_to_profile,
)
from kall.services.storage import get_storage

router = APIRouter(tags=["documents"])


class GenerateResumeRequest(BaseModel):
    template_key: str = "standard"


class CoverLetterRequest(BaseModel):
    emphasis: str = Field(default="balanced", max_length=40)
    tone: str = Field(default="formal", max_length=40)
    length: str = Field(default="standard", max_length=40)
    company_interest_notes: str | None = Field(default=None, max_length=2000)


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


@router.get("/tailoring/{proposal_id}/previews/{template_key}.png")
def preview_template(
    proposal_id: int,
    template_key: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Response:
    """The person's own resume, as it currently stands, in one look -- so
    picking a template is a choice between real pages, not swatches."""
    proposal = _owned_tailoring(session, proposal_id, current_user.id)
    if template_key not in RESUME_TEMPLATE_KEYS:
        raise HTTPException(404, "Unknown resume layout")
    return Response(content=ensure_preview(session, proposal, template_key), media_type="image/png", headers={"Cache-Control": "private, max-age=300"})


@router.get("/documents/{document_id}/preview.png")
def preview_document(
    document_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Response:
    document = session.get(GeneratedDocument, document_id)
    if not document or document.user_id != current_user.id:
        raise HTTPException(404, "Document not found")
    try:
        data = document_preview_png(session, document)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return Response(content=data, media_type="image/png", headers={"Cache-Control": "private, max-age=300"})


@router.get("/documents/{document_id}/ats-check")
def ats_check(
    document_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    """Pass/fail checks run against the rendered PDF itself."""
    document = session.get(GeneratedDocument, document_id)
    if not document or document.user_id != current_user.id:
        raise HTTPException(404, "Document not found")
    layout = document.content_json.get("layout")
    if not layout:
        raise HTTPException(404, "This document has no layout to check")
    pdf = ensure_artifact(session, document, "pdf")
    return ats_report(layout, get_storage().read(pdf.file_path))


@router.post("/documents/{document_id}/save-to-profile")
def save_to_profile(
    document_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    document = session.get(GeneratedDocument, document_id)
    if not document or document.user_id != current_user.id:
        raise HTTPException(404, "Document not found")
    if document.document_type != "resume":
        raise HTTPException(422, "Only resumes can be saved to your profile")
    pdf = ensure_artifact(session, document, "pdf")
    quota.check(session, current_user, "storage_bytes", amount=pdf.byte_size)
    resume = save_document_to_profile(session, document, session.get(Job, document.job_id) if document.job_id else None)
    return {"resume": resume}


@router.get("/documents")
def list_documents(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[dict]:
    """Every document generated for this account, newest first.

    Until now the only pointer to a generated document was the id an
    application happened to record -- a document generated from the resume
    studio without an application was unreachable after the page reloaded.
    """
    documents = list(
        session.exec(
            select(GeneratedDocument)
            .where(GeneratedDocument.user_id == current_user.id)
            .order_by(GeneratedDocument.created_at.desc(), GeneratedDocument.id.desc())
        )
    )
    job_ids = {document.job_id for document in documents if document.job_id}
    jobs = {job.id: job for job in session.exec(select(Job).where(Job.id.in_(job_ids)))} if job_ids else {}
    application_by_job = {
        application.job_id: application.id
        for application in session.exec(
            select(Application).where(Application.user_id == current_user.id, Application.job_id.in_(job_ids))
        )
    } if job_ids else {}
    return [
        {
            "id": document.id,
            "document_type": document.document_type,
            "template_key": document.template_key,
            "created_at": document.created_at,
            "job_id": document.job_id,
            "company": jobs[document.job_id].company if document.job_id in jobs else None,
            "title": jobs[document.job_id].title if document.job_id in jobs else None,
            "application_id": application_by_job.get(document.job_id),
        }
        for document in documents
    ]


@router.get("/documents/{document_id}")
def get_document(
    document_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    document = session.get(GeneratedDocument, document_id)
    if not document or document.user_id != current_user.id:
        raise HTTPException(404, "Document not found")
    # Every format is offered whether or not it has been rendered yet; a
    # size appears once one has.
    artifacts = offered_artifacts(session, document)
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
    if file_format not in ARTIFACT_FORMATS:
        raise HTTPException(404, "Document artifact not found")
    # Rendered here if this is the first request for this format, or if the
    # file was expired by the retention job. Either way the bytes are the same.
    artifact = ensure_artifact(session, document, file_format)
    storage = get_storage()
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
