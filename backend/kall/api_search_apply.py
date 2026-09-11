from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, HttpUrl
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.clock import utcnow
from kall.db import get_session
from kall.models import (
    Application,
    CareerProfile,
    Job,
    Opportunity,
    ResumeDocument,
    SuppressedResult,
    User,
)
from kall.models.enums import ApplicationStatus
from kall.schemas import ExternalJobImportRequest, PrepareApplicationRequest
from kall.services import quota
from kall.services.applications import (
    COMPLETED_STATUSES,
    existing_application_summary,
    find_existing_application,
    prepare_application,
)
from kall.services.matching import deterministic_match
from kall.services.opportunities import upsert_opportunity
from kall.services.suppression import VALID_REASONS, normalize_url

router = APIRouter()


class SuppressResultRequest(BaseModel):
    url: HttpUrl
    title: str | None = None
    reason: str = "dead_link"


class RestoreResultRequest(BaseModel):
    url: HttpUrl


class TrackExternalApplicationRequest(BaseModel):
    #: Set when the person chose to record an in-progress application as
    #: applied outside Kall anyway.
    mark_submitted_anyway: bool = False
    url: HttpUrl
    title: str
    snippet: str | None = None
    source: str = "google_cse"
    professional_profile_id: int


class CaptureJobRequest(BaseModel):
    url: HttpUrl
    title: str
    company: str | None = None
    location: str | None = None
    description: str | None = None
    professional_profile_id: int


def _company_from_url(url: str) -> str:
    host = (urlparse(url).hostname or "Unknown company").lower()
    host = host.removeprefix("www.")
    labels = host.split(".")
    if len(labels) >= 2:
        return labels[-2].replace("-", " ").title()
    return host.replace("-", " ").title()


def _import_job(session: Session, url: str, title: str, snippet: str | None, source: str) -> Job:
    existing = session.exec(select(Job).where(Job.url == url)).first()
    if existing:
        return existing
    row = Job(
        source=source,
        external_id=url,
        company=_company_from_url(url),
        title=title,
        description=snippet or "Imported from Google Programmable Search. Open the original posting for complete requirements.",
        url=url,
        metadata_json={"imported_from": "google_programmable_search"},
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.post("/jobs/import-search-result", response_model=Job)
def import_search_result(
    payload: ExternalJobImportRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Job:
    del current_user
    row = _import_job(session, str(payload.url), payload.title, payload.snippet, payload.source)
    if payload.company and row.company != payload.company:
        row.company = payload.company
        session.add(row)
        session.commit()
        session.refresh(row)
    return row


@router.post("/jobs/capture", response_model=Opportunity)
def capture_job(
    payload: CaptureJobRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Opportunity:
    """Save a job the browser extension scraped off of any site (LinkedIn,
    Indeed, a company careers page -- not just the three ATS providers
    discovery.py already knows how to search) directly into the tracked
    opportunity inbox.

    Reuses the same storage and matching this whole feature already runs
    on: _import_job's dedupe-by-URL, deterministic_match for a real score
    against the chosen profile, and upsert_opportunity so a job captured
    twice (once from a search, once from browsing) collapses into one row
    rather than two.
    """
    profile = session.get(CareerProfile, payload.professional_profile_id)
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(404, "Professional profile not found")

    job = _import_job(session, str(payload.url), payload.title, payload.description, "browser_extension")
    changed = False
    if payload.company and job.company != payload.company:
        job.company = payload.company
        changed = True
    if payload.location and not job.location:
        job.location = payload.location
        changed = True
    if changed:
        session.add(job)
        session.commit()
        session.refresh(job)

    score, _strengths, _gaps = deterministic_match(job, profile)
    return upsert_opportunity(session, user_id=current_user.id, profile_id=profile.id, job=job, match_score=score)


@router.get("/me/applications/existing")
def existing_application(
    job_id: int | None = None,
    url: str | None = None,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    """Whether this person already has an application for a posting -- by
    job or by link -- so the client can offer to continue it instead of
    starting a second one."""
    if job_id is None and not url:
        raise HTTPException(422, "Provide job_id or url")
    found = find_existing_application(session, current_user.id, job_id=job_id, url=url)
    return {"exists": found is not None, "application": existing_application_summary(session, found) if found else None}


@router.post("/applications/track-external", response_model=Application)
def track_external_application(
    payload: TrackExternalApplicationRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Application:
    profile = session.get(CareerProfile, payload.professional_profile_id)
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(404, "Professional profile not found")

    job = _import_job(session, str(payload.url), payload.title, payload.snippet, payload.source)
    existing = find_existing_application(session, current_user.id, job_id=job.id, url=job.url)
    if existing and existing.status not in COMPLETED_STATUSES and not payload.mark_submitted_anyway:
        # An application is already under way in Kall for this link. Ask the
        # person to finish it rather than silently closing it as submitted.
        summary = existing_application_summary(session, existing)
        raise HTTPException(
            409,
            {
                "code": "application_in_progress",
                "message": f"You already started this application in Kall ({summary['stage']}). Continue it, or record it as applied anyway.",
                "application": summary,
            },
        )
    if existing:
        # Only a first transition to SUBMITTED counts; re-tracking the same
        # posting must not spend a second allowance.
        newly_submitted = existing.status != ApplicationStatus.SUBMITTED
        if newly_submitted:
            quota.check(session, current_user, "applications")
        existing.status = ApplicationStatus.SUBMITTED
        existing.submitted_at = existing.submitted_at or utcnow()
        existing.prepared_payload = {**existing.prepared_payload, "tracked_externally": True}
        session.add(existing)
        session.commit()
        if newly_submitted:
            quota.record_completed_application(session, current_user)
        session.refresh(existing)
        return existing

    row = Application(
        user_id=current_user.id,
        job_id=job.id,
        career_profile_id=profile.id,
        status=ApplicationStatus.SUBMITTED,
        submitted_at=utcnow(),
        prepared_payload={"tracked_externally": True, "source": payload.source},
    )
    quota.check(session, current_user, "applications")
    session.add(row)
    session.commit()
    # Replaces a raw increment of User.completed_application_count, which
    # bypassed the usage counter entirely -- so the application cap never
    # actually bound. record_completed_application keeps both in step.
    quota.record_completed_application(session, current_user)
    session.refresh(row)
    return row


@router.post("/applications/prepare-options", response_model=Application)
def prepare_with_options(
    payload: PrepareApplicationRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Application:
    job = session.get(Job, payload.job_id)
    profile = session.get(CareerProfile, payload.professional_profile_id)
    resume = session.get(ResumeDocument, payload.resume_id) if payload.resume_id else None
    if not job or not profile or profile.user_id != current_user.id:
        raise HTTPException(404, "Required record not found")
    if resume and resume.user_id != current_user.id:
        raise HTTPException(403, "Resume does not belong to user")

    return prepare_application(
        session,
        current_user,
        job,
        profile,
        resume,
        customize_resume=payload.customize_resume,
        generate_cover_letter=payload.generate_cover_letter,
        application_mode=payload.application_mode,
    )


@router.get("/search/suppressed", response_model=list[SuppressedResult])
def list_suppressed_results(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[SuppressedResult]:
    return list(
        session.exec(
            select(SuppressedResult)
            .where(SuppressedResult.user_id == current_user.id)
            .order_by(SuppressedResult.suppressed_at.desc())
        )
    )


@router.post("/search/suppressed", response_model=SuppressedResult)
def suppress_result(
    payload: SuppressResultRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> SuppressedResult:
    if payload.reason not in VALID_REASONS:
        raise HTTPException(status_code=422, detail="Unsupported suppression reason")
    url = normalize_url(str(payload.url))
    row = session.exec(
        select(SuppressedResult).where(
            SuppressedResult.user_id == current_user.id,
            SuppressedResult.url == url,
        )
    ).first()
    if row:
        # Re-flagging an already-hidden result upgrades the reason rather than
        # duplicating it: a posting hidden because it was applied to can later
        # turn out to be dead, and that is the reason worth keeping.
        row.reason = payload.reason
        row.title = payload.title or row.title
        row.suppressed_at = utcnow()
    else:
        row = SuppressedResult(
            user_id=current_user.id, url=url, reason=payload.reason, title=payload.title
        )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


# The posting URL goes in the body rather than a query parameter --
# job-board links carry their own query strings, and nesting one inside
# another is needless encoding trouble.
@router.delete("/search/suppressed")
def restore_result(
    payload: RestoreResultRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    url = normalize_url(str(payload.url))
    row = session.exec(
        select(SuppressedResult).where(
            SuppressedResult.user_id == current_user.id,
            SuppressedResult.url == url,
        )
    ).first()
    if row:
        session.delete(row)
        session.commit()
    return {"status": "restored"}


@router.delete("/search/suppressed/all")
def restore_all_results(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, int]:
    rows = list(
        session.exec(select(SuppressedResult).where(SuppressedResult.user_id == current_user.id))
    )
    for row in rows:
        session.delete(row)
    session.commit()
    return {"restored": len(rows)}
