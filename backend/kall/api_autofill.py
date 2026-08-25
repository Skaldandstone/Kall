from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session

from kall.auth import get_current_user
from kall.db import get_session
from kall.models import Application, ResumeDocument, User
from kall.services.autofill import build_autofill_pack
from kall.services.storage import get_storage

router = APIRouter(tags=["autofill"])


@router.get("/applications/{application_id}/autofill-pack")
def autofill_pack(
    application_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    application = session.get(Application, application_id)
    if not application or application.user_id != current_user.id:
        raise HTTPException(404, "Application not found")
    return build_autofill_pack(session, current_user, application)


@router.get("/me/resumes/{resume_id}/download")
def download_resume(
    resume_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Response:
    """Serves the stored resume bytes.

    Every other resume endpoint returns metadata only, so there was no way to
    attach the file the user already uploaded to an employer's form -- they
    had to find and re-upload it themselves. Mirrors
    api_documents.download_document: ownership is re-checked here rather than
    relying on an unguessable id.
    """
    resume = session.get(ResumeDocument, resume_id)
    if not resume or resume.user_id != current_user.id:
        raise HTTPException(404, "Resume not found")
    return Response(
        content=get_storage().read(resume.file_path),
        media_type=resume.mime_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{resume.name}"'},
    )
