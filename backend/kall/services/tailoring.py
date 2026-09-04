import re
from datetime import datetime

from kall.models import (
    Achievement,
    Job,
    JobRequirementAnalysis,
    ResumeDocument,
    ResumeSelection,
    TailoringAudit,
    TailoringChange,
    TailoringProposal,
)
from sqlmodel import Session, select

IMMUTABLE_PATTERN = re.compile(r"\b(?:19|20)\d{2}\b|\b\d+(?:\.\d+)?%\b|\$\d[\d,]*(?:\.\d+)?[KMB]?\b", re.I)


def immutable_tokens(text: str) -> list[str]:
    return IMMUTABLE_PATTERN.findall(text)


def preserves_immutable_facts(original: str, proposed: str) -> bool:
    return set(immutable_tokens(original)).issubset(set(immutable_tokens(proposed)))


#: PDF text extraction (pypdf) routinely splits a header block -- name,
#: phone, email, address, each on its own visual line -- into several
#: blank-line-separated "paragraphs" before the real summary paragraph,
#: especially for multi-column resume headers. Naively taking the first
#: paragraph as "the summary" was picking up "James\n\nShattuck\n\n
#: 360-809-2664" instead, which is not a summary and cannot be meaningfully
#: improved. A short paragraph, or one containing an email/phone, is header
#: noise to skip past rather than the summary itself.
_EMAIL_PATTERN = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE_PATTERN = re.compile(r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b")
_MIN_SUMMARY_WORDS = 5


def _looks_like_header_noise(paragraph: str) -> bool:
    if len(paragraph.split()) < _MIN_SUMMARY_WORDS:
        return True
    return bool(_EMAIL_PATTERN.search(paragraph) or _PHONE_PATTERN.search(paragraph))


def _find_summary_paragraph(text: str) -> str:
    paragraphs = [p.strip() for p in text.strip().split("\n\n") if p.strip()]
    for paragraph in paragraphs:
        if not _looks_like_header_noise(paragraph):
            return paragraph[:800]
    # Every paragraph looked like header noise (e.g. a resume with no
    # distinct summary section) -- fall back to whatever came first rather
    # than proposing a change against empty text.
    return (paragraphs[0] if paragraphs else "")[:800]


def _summary_change(resume: ResumeDocument, job: Job, skills: list[str]) -> TailoringChange:
    original = _find_summary_paragraph(resume.extracted_text or "")
    focus = ", ".join(skills[:5]) or "the role's documented requirements"
    proposed = f"{original}\n\nRole focus: {job.title} at {job.company}, emphasizing {focus}.".strip()
    return TailoringChange(
        section="summary",
        original_text=original,
        proposed_text=proposed,
        reason="Align the opening summary with explicit job requirements without adding claims.",
        evidence=[{"type": "job", "id": job.id, "text": focus}],
        immutable_tokens=immutable_tokens(original),
    )


def create_tailoring_proposal(
    session: Session,
    user_id: int,
    job: Job,
    professional_profile_id: int,
) -> TailoringProposal:
    selection = session.exec(
        select(ResumeSelection).where(
            ResumeSelection.user_id == user_id,
            ResumeSelection.job_id == job.id,
            ResumeSelection.professional_profile_id == professional_profile_id,
        )
    ).first()
    resume_id = selection.selected_resume_id if selection else None
    if not resume_id and selection:
        resume_id = selection.recommended_resume_id
    resume = session.get(ResumeDocument, resume_id) if resume_id else None
    if not resume or resume.user_id != user_id:
        raise ValueError("A user-owned selected or recommended resume is required")

    analysis = session.exec(
        select(JobRequirementAnalysis).where(JobRequirementAnalysis.job_id == job.id)
    ).first()
    required = analysis.required_skills if analysis else []
    preferred = analysis.preferred_skills if analysis else []
    verified = list(
        session.exec(
            select(Achievement).where(
                Achievement.user_id == user_id,
                Achievement.verification_status == "verified",
            )
        )
    )

    evidence_text = " ".join(
        [resume.extracted_text or ""]
        + [a.achievement_text for a in verified]
    ).lower()
    unsupported = [item for item in required if item.lower() not in evidence_text]

    proposal = TailoringProposal(
        user_id=user_id,
        job_id=job.id,
        resume_id=resume.id,
        professional_profile_id=professional_profile_id,
        unsupported_requirements=unsupported,
    )
    session.add(proposal)
    session.commit()
    session.refresh(proposal)

    changes = [_summary_change(resume, job, required + preferred)]
    relevant = [
        a for a in verified
        if any(skill.lower() in (a.achievement_text + " " + " ".join(a.skills)).lower() for skill in required + preferred)
    ]
    for achievement in relevant[:6]:
        changes.append(
            TailoringChange(
                proposal_id=proposal.id,
                section="achievements",
                original_text=achievement.achievement_text,
                proposed_text=achievement.achievement_text,
                reason="Verified achievement aligns with one or more job requirements.",
                evidence=[{"type": "achievement", "id": achievement.id, "text": achievement.achievement_text}],
                immutable_tokens=immutable_tokens(achievement.achievement_text),
            )
        )
    changes[0].proposal_id = proposal.id
    session.add_all(changes)
    session.add(TailoringAudit(proposal_id=proposal.id, event="proposal_created", details={"provider": "deterministic"}))
    session.commit()
    session.refresh(proposal)
    return proposal


def review_change(session: Session, change: TailoringChange, status: str, edited_text: str | None) -> TailoringChange:
    if status not in {"accepted", "edited", "rejected"}:
        raise ValueError("Invalid review status")
    final_text = edited_text if status == "edited" else change.proposed_text
    if status != "rejected" and not preserves_immutable_facts(change.original_text, final_text or ""):
        raise ValueError("Dates, percentages, compensation, and metrics from the source must be preserved")
    change.status = status
    change.edited_text = edited_text if status == "edited" else None
    change.reviewed_at = datetime.utcnow()
    session.add(change)
    session.add(TailoringAudit(proposal_id=change.proposal_id, event="change_reviewed", details={"change_id": change.id, "status": status}))
    session.commit()
    session.refresh(change)
    return change


def finalize_proposal(session: Session, proposal: TailoringProposal) -> TailoringProposal:
    changes = list(session.exec(select(TailoringChange).where(TailoringChange.proposal_id == proposal.id)))
    if not changes or any(change.status == "pending" for change in changes):
        raise ValueError("Every tailoring change must be reviewed before finalization")
    proposal.status = "finalized"
    proposal.finalized_at = datetime.utcnow()
    session.add(proposal)
    session.add(TailoringAudit(proposal_id=proposal.id, event="proposal_finalized"))
    session.commit()
    session.refresh(proposal)
    return proposal
