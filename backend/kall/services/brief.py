"""The daily brief: a grounded summary assembled from what Kall already
knows about someone, not a generated one.

Moved out of api_brief.py so the same logic backs both the in-app page
(`GET /me/morning-brief`) and the emailed version
(`notification_delivery.py`'s morning_brief kind). Two copies of this would
have drifted the way `apply_subscription_event` and `quota.py` once
disagreed about which plan a user was on -- one function, two callers, is
what keeps the email actually matching what the app shows.

Deliberately deterministic throughout: it reports stored facts and
transparent readiness heuristics, and invents nothing -- no recruiter
activity, no interviews, no AI findings that are not backed by a row
somewhere.
"""

from collections import Counter
from datetime import UTC, datetime
from typing import Any

from kall.models import (
    Application,
    CandidateProfile,
    CareerProfile,
    Job,
    JobMatch,
    ResumeDocument,
    User,
)
from kall.models.enums import ApplicationStatus
from sqlmodel import Session, select


def _dimension(score: int, label: str, explanation: str) -> dict[str, Any]:
    return {
        "label": label,
        "score": max(0, min(100, score)),
        "explanation": explanation,
    }


def build_morning_brief(session: Session, user: User) -> dict[str, Any]:
    candidate = session.exec(
        select(CandidateProfile).where(CandidateProfile.user_id == user.id)
    ).first()
    profiles = list(
        session.exec(
            select(CareerProfile).where(
                CareerProfile.user_id == user.id,
                CareerProfile.is_active.is_(True),
            )
        )
    )
    resumes = list(session.exec(select(ResumeDocument).where(ResumeDocument.user_id == user.id)))
    applications = list(session.exec(select(Application).where(Application.user_id == user.id)))
    matches = list(
        session.exec(
            select(JobMatch)
            .where(JobMatch.user_id == user.id)
            .order_by(JobMatch.score.desc(), JobMatch.updated_at.desc())
            .limit(10)
        )
    )

    opportunities: list[dict[str, Any]] = []
    seen_jobs: set[int] = set()
    for match in matches:
        if match.job_id in seen_jobs:
            continue
        job = session.get(Job, match.job_id)
        if not job:
            continue
        seen_jobs.add(match.job_id)
        opportunities.append(
            {
                "job_id": job.id,
                "match_id": match.id,
                "company": job.company,
                "title": job.title,
                "location": job.location,
                "work_type": job.work_type,
                "score": match.score,
                "recommendation": match.recommendation,
                "strengths": match.strengths[:3],
                "gaps": match.gaps[:3],
                "url": job.url,
            }
        )
        if len(opportunities) == 3:
            break

    target_count = sum(len(profile.target_titles) for profile in profiles)
    direction_score = 90 if target_count >= 2 else 72 if target_count == 1 else 35
    resume_score = 90 if any(resume.is_default for resume in resumes) else 72 if resumes else 25
    market_score = opportunities[0]["score"] if opportunities else 30
    active_applications = [
        application
        for application in applications
        if str(application.status.value if hasattr(application.status, "value") else application.status)
        not in {"accepted", "rejected", "withdrawn"}
    ]
    momentum_score = min(100, 35 + len(active_applications) * 12) if applications else 30

    dimensions = [
        _dimension(
            direction_score,
            "Direction",
            "Based on the number of active target roles in your professional profiles.",
        ),
        _dimension(
            resume_score,
            "Resume readiness",
            "Based on whether you have uploaded resumes and selected a default starting point.",
        ),
        _dimension(
            market_score,
            "Market alignment",
            "Based on your highest stored deterministic job-match score.",
        ),
        _dimension(
            momentum_score,
            "Application momentum",
            "Based on the number of applications currently in progress.",
        ),
    ]
    career_health = round(sum(item["score"] for item in dimensions) / len(dimensions))

    status_counts = Counter(
        str(application.status.value if hasattr(application.status, "value") else application.status)
        for application in applications
    )
    preferred_name = (
        candidate.preferred_name
        if candidate and candidate.preferred_name
        else user.full_name.split()[0]
    )

    # Approved applications are the ones where every review gate has already
    # been cleared, so the only thing left is filling the employer's form --
    # that is the most actionable thing in the brief when it exists.
    ready_to_autofill = [
        application
        for application in applications
        if str(application.status.value if hasattr(application.status, "value") else application.status)
        == ApplicationStatus.APPROVED.value
    ]

    if ready_to_autofill:
        count = len(ready_to_autofill)
        focus = {
            "kind": "autofill",
            "title": f"{count} application{'' if count == 1 else 's'} ready to fill",
            "detail": "Reviewed and approved. Open one to pre-fill the employer's form.",
            "href": f"/applications/{ready_to_autofill[0].id}",
        }
    elif opportunities:
        focus = {
            "kind": "opportunity",
            "title": f"Review {opportunities[0]['title']} at {opportunities[0]['company']}",
            "detail": f"It is your strongest current match at {opportunities[0]['score']}%.",
            "href": "/job-intelligence",
        }
    elif not resumes:
        focus = {
            "kind": "resume",
            "title": "Add your first resume",
            "detail": "A resume gives Kall evidence for opportunity matching and application preparation.",
            "href": "/resume-intelligence",
        }
    elif not profiles:
        focus = {
            "kind": "profile",
            "title": "Define a professional profile",
            "detail": "Target roles and work preferences make recommendations more relevant.",
            "href": "/onboarding",
        }
    else:
        focus = {
            "kind": "discovery",
            "title": "Run an opportunity search",
            "detail": "Your profile is ready, but no evaluated opportunities are stored yet.",
            "href": "/search",
        }

    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "user": {"preferred_name": preferred_name},
        "focus": focus,
        "opportunities": opportunities,
        "career_health": {"score": career_health, "dimensions": dimensions},
        "applications": {
            "total": len(applications),
            "active": len(active_applications),
            "ready_to_autofill": len(ready_to_autofill),
            "by_status": dict(status_counts),
        },
        "resumes": {
            "total": len(resumes),
            "default_resume_id": next(
                (resume.id for resume in resumes if resume.is_default),
                None,
            ),
        },
    }
