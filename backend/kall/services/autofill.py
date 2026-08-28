"""Builds the payload Kall uses to pre-fill an employer's application form.

The user submits the form themselves on the employer's site -- Kall only
pre-fills it. That's what keeps this safe: no third-party ToS problem, no
CAPTCHA to work around, and the user personally sees and owns every EEO and
work-authorization answer rather than Kall attesting to legal questions for
them.

Two rules shape everything here:

1. Nothing is filled that the user hasn't consented to, per AutofillTier.
2. Anything withheld is reported in `omitted` with a reason. Silently
   dropping fields is how someone ends up submitting a half-empty form
   without understanding why.
"""

from datetime import date

from kall.models import (
    Application,
    ApplicationAnswer,
    CandidateProfile,
    Education,
    EEOProfile,
    Employment,
    Job,
    ResumeDocument,
    ScreeningQuestion,
    User,
    WorkAuthorization,
)
from kall.models.enums import AUTOFILL_FIELD_TIERS, AutofillTier, PrivacyScope
from kall.security import decrypt_sensitive
from kall.services.privacy import field_allowed
from sqlmodel import Session, select

# Human-readable labels for the review panel and, later, the extension's
# "here's what I filled" summary.
FIELD_LABELS: dict[str, str] = {
    "identity.legal_name": "Full name",
    "identity.email": "Email",
    "identity.phone": "Phone",
    "identity.address": "Street address",
    "identity.postal_code": "Postal code",
    "identity.city": "City",
    "identity.state_region": "State / region",
    "identity.country": "Country",
    "identity.linkedin_url": "LinkedIn",
    "identity.github_url": "GitHub",
    "identity.portfolio_urls": "Portfolio",
    "identity.website_urls": "Website",
    "employment.current_employer": "Current / most recent employer",
    "employment.current_title": "Current / most recent title",
    "education.most_recent": "Most recent school",
    "work_authorization.authorization_type": "Work authorization",
    "work_authorization.citizenship": "Citizenship status",
    "work_authorization.requires_current_sponsorship": "Requires sponsorship now",
    "work_authorization.requires_future_sponsorship": "Will require sponsorship in future",
    "eeo.veteran_status": "Veteran status",
    "eeo.disability_status": "Disability status",
    "eeo.race_ethnicity": "Race / ethnicity",
    "eeo.gender_identity": "Gender identity",
}


def _sort_key(row: Employment) -> tuple[int, date]:
    """Most recent first: current roles win, then latest start date."""
    return (1 if row.is_current else 0, row.start_date or date.min)


def most_recent_employment(session: Session, user_id: int) -> Employment | None:
    rows = list(session.exec(select(Employment).where(Employment.user_id == user_id)))
    return max(rows, key=_sort_key) if rows else None


def most_recent_education(session: Session, user_id: int) -> Education | None:
    rows = list(session.exec(select(Education).where(Education.user_id == user_id)))
    if not rows:
        return None
    return max(rows, key=lambda row: row.graduation_date or date.min)


def _collect_values(session: Session, user: User) -> dict[str, object]:
    """Every autofillable value Kall can source, before any consent filtering."""
    profile = session.exec(
        select(CandidateProfile).where(CandidateProfile.user_id == user.id)
    ).first()
    eeo = session.exec(select(EEOProfile).where(EEOProfile.user_id == user.id)).first()
    # WorkAuthorization is one row per country; the user's own country is the
    # relevant one for a form asking "are you authorized to work here".
    authorizations = list(
        session.exec(select(WorkAuthorization).where(WorkAuthorization.user_id == user.id))
    )
    country = (profile.country if profile else None) or user.country
    work_auth = next(
        (row for row in authorizations if row.country == country), authorizations[0] if authorizations else None
    )
    employment = most_recent_employment(session, user.id)
    education = most_recent_education(session, user.id)

    values: dict[str, object] = {
        "identity.legal_name": user.full_name,
        "identity.email": user.email,
        "identity.city": profile.city if profile else None,
        "identity.state_region": (profile.state_region if profile else None) or user.state_region,
        "identity.country": country,
        "identity.linkedin_url": profile.linkedin_url if profile else None,
        "identity.github_url": profile.github_url if profile else None,
        "identity.portfolio_urls": (profile.portfolio_urls or [None])[0] if profile else None,
        "identity.website_urls": (profile.website_urls or [None])[0] if profile else None,
        "identity.phone": decrypt_sensitive(profile.phone_encrypted) if profile else None,
        "identity.address": decrypt_sensitive(profile.address_encrypted) if profile else None,
        "identity.postal_code": decrypt_sensitive(profile.postal_code_encrypted) if profile else None,
        "employment.current_employer": employment.employer if employment else None,
        "employment.current_title": employment.job_title if employment else None,
        "education.most_recent": education.institution if education else None,
    }

    if work_auth:
        values["work_authorization.authorization_type"] = work_auth.authorization_type
        values["work_authorization.citizenship"] = decrypt_sensitive(work_auth.citizenship_status_encrypted)
        values["work_authorization.requires_current_sponsorship"] = work_auth.requires_current_sponsorship
        values["work_authorization.requires_future_sponsorship"] = work_auth.requires_future_sponsorship

    if eeo:
        # decline_to_answer_defaults means "don't pre-select an answer" -- the
        # stored values still exist, but the pack must not arrive pre-answered.
        declining = eeo.decline_to_answer_defaults
        values["eeo.veteran_status"] = None if declining else decrypt_sensitive(eeo.veteran_status_encrypted)
        values["eeo.disability_status"] = None if declining else decrypt_sensitive(eeo.disability_status_encrypted)
        values["eeo.race_ethnicity"] = None if declining else decrypt_sensitive(eeo.race_ethnicity_encrypted)
        values["eeo.gender_identity"] = None if declining else decrypt_sensitive(eeo.gender_identity_encrypted)

    return values


def _screening_answers(session: Session, application: Application) -> list[dict]:
    """Reviewed answers to this application's own screening questions.

    Reuses the existing ScreeningQuestion/ApplicationAnswer review records
    rather than a parallel store, so an answer only reaches a form after it
    went through the same review the rest of the pipeline requires.
    """
    questions = {
        row.id: row
        for row in session.exec(
            select(ScreeningQuestion).where(ScreeningQuestion.application_id == application.id)
        )
    }
    answers = list(
        session.exec(select(ApplicationAnswer).where(ApplicationAnswer.application_id == application.id))
    )
    rows: list[dict] = []
    for answer in answers:
        question = questions.get(answer.question_id)
        if not question:
            continue
        rows.append({
            "key": question.key,
            "prompt": question.prompt,
            "question_type": question.question_type,
            "options": question.options,
            "sensitive": question.sensitive,
            "value": answer.value,
            "status": answer.status,
            "requires_confirmation": question.sensitive or answer.status not in {"accepted", "edited"},
        })
    return rows


def autofill_payload_sections(session: Session, user: User, application: Application) -> dict:
    """The sections build_preview() expects inside Application.prepared_payload.

    Deliberately metadata-only. prepared_payload is a plaintext JSON column,
    so putting decrypted values (phone, street address, citizenship, EEO
    self-identification) in it would write exactly the data the models
    bother to encrypt at rest back out in the clear, and then checksum it
    into the immutable submission preview as well. What the preview needs is
    whether these were resolved and whether they still need confirmation --
    not the values themselves. The real values are assembled on demand by
    build_autofill_pack() and never persisted.
    """
    eeo = session.exec(select(EEOProfile).where(EEOProfile.user_id == user.id)).first()
    authorizations = list(
        session.exec(select(WorkAuthorization).where(WorkAuthorization.user_id == user.id))
    )
    profile = session.exec(
        select(CandidateProfile).where(CandidateProfile.user_id == user.id)
    ).first()
    country = (profile.country if profile else None) or user.country
    work_auth = next(
        (row for row in authorizations if row.country == country), authorizations[0] if authorizations else None
    )

    return {
        "screening_answers": {
            row["key"]: row["value"] for row in _screening_answers(session, application) if row["value"] is not None
        },
        "work_authorization": None if not work_auth else {
            "country": work_auth.country,
            # Plaintext in the model already, and non-identifying.
            "authorization_type": work_auth.authorization_type,
            "requires_current_sponsorship": work_auth.requires_current_sponsorship,
            "requires_future_sponsorship": work_auth.requires_future_sponsorship,
            "citizenship_on_file": bool(work_auth.citizenship_status_encrypted),
            "confirmation_required": True,
        },
        "eeo": None if not eeo else {
            "on_file": True,
            "declines_by_default": eeo.decline_to_answer_defaults,
            "confirmation_required": True,
        },
    }


def build_autofill_pack(session: Session, user: User, application: Application) -> dict:
    values = _collect_values(session, user)
    job = session.get(Job, application.job_id)

    fields: list[dict] = []
    omitted: list[dict] = []

    for path, tier in AUTOFILL_FIELD_TIERS.items():
        value = values.get(path)

        if tier is AutofillTier.OPT_IN and not field_allowed(session, user.id, path, PrivacyScope.AUTOFILL):
            omitted.append({
                "path": path,
                "label": FIELD_LABELS.get(path, path),
                "reason": "Not enabled for autofill in your privacy settings.",
            })
            continue

        if value in (None, ""):
            omitted.append({
                "path": path,
                "label": FIELD_LABELS.get(path, path),
                "reason": "No value saved in your Kall profile yet.",
            })
            continue

        fields.append({
            "path": path,
            "label": FIELD_LABELS.get(path, path),
            "value": value,
            "tier": tier.value,
            # EEO and work authorization are never filled silently, no matter
            # what any FieldPrivacy rule says.
            "requires_confirmation": tier is AutofillTier.ALWAYS_CONFIRM,
        })

    resume = None
    resume_id = application.base_resume_id
    if resume_id:
        row = session.get(ResumeDocument, resume_id)
        if row and row.user_id == user.id:
            resume = {
                "resume_id": row.id,
                "filename": row.name,
                "mime_type": row.mime_type,
                "download_url": f"/api/me/resumes/{row.id}/download",
            }
    if resume is None:
        omitted.append({
            "path": "documents.resume",
            "label": "Resume",
            "reason": "No resume is attached to this application.",
        })

    return {
        "application_id": application.id,
        "job": {
            "company": job.company if job else None,
            "title": job.title if job else None,
            "url": job.url if job else None,
        },
        "provider": (application.ats_provider or "manual").lower(),
        "fields": fields,
        "resume": resume,
        "screening_answers": _screening_answers(session, application),
        "omitted": omitted,
    }
