from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.db import get_session
from kall.models import Application, ApplicationSubmission, SubmissionAttempt, User
from kall.services import quota
from kall.services.submissions import (
    confirm_submission,
    create_attempt,
    find_attempt,
    prepare_submission,
    validate_submission,
)

router = APIRouter(tags=["submissions"])


def owned_application(session: Session, user: User, application_id: int) -> Application:
    item = session.get(Application, application_id)
    if not item or item.user_id != user.id:
        raise HTTPException(404, "Application not found")
    return item


def owned_submission(session: Session, user: User, submission_id: int) -> ApplicationSubmission:
    item = session.get(ApplicationSubmission, submission_id)
    if not item or item.user_id != user.id:
        raise HTTPException(404, "Submission not found")
    return item


@router.post("/applications/{application_id}/submission-preview", response_model=ApplicationSubmission)
def prepare(
    application_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ApplicationSubmission:
    return prepare_submission(session, owned_application(session, user, application_id))


@router.get("/submissions")
def list_submissions(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    return list(session.exec(select(ApplicationSubmission).where(ApplicationSubmission.user_id == user.id)))


@router.get("/submissions/{submission_id}")
def get_submission(
    submission_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    item = owned_submission(session, user, submission_id)
    attempts = list(session.exec(select(SubmissionAttempt).where(SubmissionAttempt.submission_id == item.id)))
    return {"submission": item, "validation_issues": validate_submission(session, item), "attempts": attempts}


@router.post("/submissions/{submission_id}/confirm", response_model=ApplicationSubmission)
def confirm(
    submission_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ApplicationSubmission:
    return confirm_submission(session, owned_submission(session, user, submission_id))


@router.post("/submissions/{submission_id}/attempt", response_model=SubmissionAttempt)
def attempt(
    submission_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> SubmissionAttempt:
    item = owned_submission(session, user, submission_id)
    if item.status != "confirmed":
        raise HTTPException(422, "Fresh submission confirmation is required")
    # A connector submission is the same "applying" event the applications
    # meter already counts for a manual kanban move (see move_application in
    # api_applications.py) -- both are a person completing one application.
    # Only a genuinely new attempt should draw against the quota; retrying an
    # already-attempted submission returns the same idempotent attempt for
    # free, or a second charge for one application.
    is_new_attempt = find_attempt(session, item) is None
    if is_new_attempt:
        quota.check(session, user, "applications")
    # Provider transport remains an adapter boundary. This creates one idempotent attempt only.
    result = create_attempt(session, item)
    if is_new_attempt:
        quota.record_completed_application(session, user)
        # record_completed_application's own commit expires every object
        # tracked by this session, `result` included -- refresh it back so
        # the response has data instead of an emptied-out row.
        session.refresh(result)
    return result
