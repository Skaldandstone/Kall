import re

from kall.clock import utcnow
from kall.config import get_settings
from kall.models import (
    Achievement,
    Employment,
    Job,
    JobRequirementAnalysis,
    ResumeDocument,
    ResumeSelection,
    TailoringAudit,
    TailoringChange,
    TailoringProposal,
    User,
)
from kall.services.openai_json import ask_for_json
from kall.services.quota import assert_ai_allowed, record_ai_action
from kall.services.resume import reflow_extracted_text
from kall.services.role_gaps import RoleContext, find_gaps, suggest_role_gaps
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


#: A resume's skills/tools/education block reads as real prose by word
#: count and has no contact info in it, so the header-noise check alone
#: waved it through as "the summary" -- concretely, a paragraph opening
#: "Languages & Tools: Java, JavaScript, ... Education: ... GPA: 3.7" is an
#: inventory, not a narrative summary, and proposing changes against it
#: produces a "summary" that is really a copy of someone's skill list.
_LIST_LABEL_PATTERN = re.compile(
    r"^\s*(languages?(?:\s*&\s*|\s+and\s+)?tools?|tech(?:nical)?\s*(?:stack|skills)?|"
    r"skills?|tools?|technologies|core competenc(?:y|ies)|certifications?|education)\s*:",
    re.IGNORECASE,
)


def _looks_like_list_block(paragraph: str) -> bool:
    if _LIST_LABEL_PATTERN.match(paragraph):
        return True
    # Untagged inventories still read as a run of short comma-separated
    # tokens with little real sentence structure -- many commas, almost no
    # sentence-ending punctuation relative to length.
    words = paragraph.split()
    commas = paragraph.count(",")
    sentences = len(re.findall(r"[.!?](?:\s|$)", paragraph))
    return len(words) >= 8 and commas >= 6 and sentences <= 1


def _looks_like_header_noise(paragraph: str) -> bool:
    if len(paragraph.split()) < _MIN_SUMMARY_WORDS:
        return True
    if _EMAIL_PATTERN.search(paragraph) or _PHONE_PATTERN.search(paragraph):
        return True
    return _looks_like_list_block(paragraph)


_CONTACT_PATTERN = re.compile(rf"(?:{_EMAIL_PATTERN.pattern}|{_PHONE_PATTERN.pattern})")
_SEPARATOR_PATTERN = re.compile(r"^[\s•●▪‣|·,\-]+")


def _strip_contact_header(paragraph: str) -> str:
    """Drop a contact header that shares a paragraph with the summary --
    "James Shattuck 360-809-2664 • Vancouver, WA • james@x.com Strategic
    Director..." -- by cutting through the last contact token that appears
    in the opening stretch, then any separator glyphs after it. Everything
    before the first sentence of real prose is header, never summary."""
    head = paragraph[:240]
    last = None
    for match in _CONTACT_PATTERN.finditer(head):
        last = match
    if not last:
        return paragraph
    remainder = _SEPARATOR_PATTERN.sub("", paragraph[last.end():])
    # A trailing location fragment ("Vancouver, WA") can follow the last
    # contact token; skip it when the prose clearly starts after a separator.
    if len(remainder.split()) >= _MIN_SUMMARY_WORDS:
        return remainder
    return paragraph


def _find_summary_paragraph(text: str) -> str:
    text = reflow_extracted_text(text)
    paragraphs = [p.strip() for p in text.strip().split("\n\n") if p.strip()]
    for paragraph in paragraphs:
        if not _looks_like_header_noise(paragraph):
            return paragraph[:800]
    # No paragraph is clean prose: either the header and summary landed in
    # one block (strip the header out of it) or the resume simply has no
    # summary -- in which case whatever came first is still the honest
    # target rather than empty text.
    for paragraph in paragraphs:
        stripped = _strip_contact_header(paragraph)
        if stripped != paragraph and not _looks_like_header_noise(stripped):
            return stripped[:800]
    return (paragraphs[0] if paragraphs else "")[:800]


#: Common words that would otherwise dominate the fallback keyword list below
#: without meaning anything as a matching signal.
_KEYWORD_STOPWORDS = {
    "the", "and", "for", "with", "you", "your", "our", "this", "that", "are",
    "have", "will", "from", "must", "required", "preferred", "minimum",
    "qualification", "qualifications", "experience", "years", "ability",
    "able", "strong", "excellent", "working", "knowledge", "skills",
    "including", "other", "such", "also", "role", "team", "work",
}


def _requirement_keywords(lines: list[str]) -> list[str]:
    """Significant words pulled straight from the posting's own requirement
    lines -- a fallback matching signal for when a posting's text doesn't
    contain any word from intelligence.SKILL_TERMS. That vocabulary is
    deliberately small and curated (see its own docstring), so a posting
    phrased in plain, non-software language can legitimately match none of
    it; without this fallback, JobRequirementAnalysis.required_skills and
    preferred_skills both come back empty and create_tailoring_proposal
    silently generates zero achievement matches and zero role-gap
    suggestions -- only ever the summary change ever gets proposed."""
    words: list[str] = []
    for line in lines:
        for word in re.findall(r"[A-Za-z][A-Za-z0-9+/#.'-]{3,}", line):
            lowered = word.casefold()
            if lowered not in _KEYWORD_STOPWORDS:
                words.append(lowered)
    return list(dict.fromkeys(words))


_SUMMARY_SCHEMA = {
    "type": "object",
    "properties": {"summary": {"type": "string"}},
    "required": ["summary"],
    "additionalProperties": False,
}


def _rules_based_summary(original: str, job: Job, focus: str) -> str:
    """A plain fallback summary that still reads as resume prose -- not a
    "Role focus: X at Y, emphasizing Z" annotation describing what was
    changed, which is what this produced before and read as leftover
    scaffolding rather than something a person would put on their resume."""
    if not original:
        return f"{job.title} candidate with a background in {focus}."
    return f"{original} Well-positioned for {job.title} at {job.company}, with strengths in {focus}."


def _drafted_summary_with_source(original: str, job: Job, focus: str) -> tuple[str, bool]:
    """A single model call rewrites the summary as flowing prose that
    naturally works the posting's own focus areas in, when a key is
    configured -- otherwise the rules-based sentence above stands in. Either
    way the result must preserve every immutable fact from the original;
    a model rewrite that drops one falls back to the deterministic sentence
    rather than risk producing a proposal review_change would refuse to let
    the person accept."""
    if get_settings().openai_api_key:
        prompt = (
            f"Rewrite this resume summary so it naturally emphasizes fit for '{job.title}' at {job.company}, "
            f"weaving in these skills where true to the original: {focus}. Two to four sentences, professional "
            "resume voice -- not a description of what changed or why. Preserve every date, percentage, dollar "
            f"amount, and other number from the original exactly. Never invent new facts, employers, or credentials."
            f"\n\nOriginal summary: {(original or '(no existing summary)')[:6000]}"
        )
        result = ask_for_json(
            prompt,
            schema_name="tailored_summary",
            schema=_SUMMARY_SCHEMA,
            purpose="summary rewrite",
            source_ref=f"job:{job.id}",
        )
        candidate = str((result or {}).get("summary", "")).strip()
        if candidate and preserves_immutable_facts(original, candidate):
            return candidate, True
    return _rules_based_summary(original, job, focus), False


def _drafted_summary(original: str, job: Job, focus: str) -> str:
    """Compatibility wrapper for callers that only need the drafted text."""
    return _drafted_summary_with_source(original, job, focus)[0]


def _summary_change(resume: ResumeDocument, job: Job, skills: list[str]) -> TailoringChange:
    original = _find_summary_paragraph(resume.extracted_text or "")
    focus = ", ".join(skills[:5]) or "the role's documented requirements"
    proposed, used_ai = _drafted_summary_with_source(original, job, focus)
    return TailoringChange(
        section="summary",
        original_text=original,
        proposed_text=proposed,
        reason="Align the opening summary with explicit job requirements without adding claims.",
        evidence=[{
            "type": "job",
            "id": job.id,
            "text": focus,
            "source": "model" if used_ai else "rules",
        }],
        immutable_tokens=immutable_tokens(original),
    )


def create_tailoring_proposal(
    session: Session,
    user_id: int,
    job: Job,
    professional_profile_id: int,
) -> TailoringProposal:
    user = session.get(User, user_id)
    if get_settings().openai_api_key and user:
        assert_ai_allowed(session, user)
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
    requirement_terms = required + preferred
    if not requirement_terms and analysis and analysis.explicit_requirements:
        # required_skills/preferred_skills matched nothing from the curated
        # SKILL_TERMS vocabulary -- fall back to keywords straight from the
        # posting's own requirement lines rather than silently proposing
        # nothing but a summary rewrite.
        requirement_terms = _requirement_keywords(analysis.explicit_requirements)
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

    changes = [_summary_change(resume, job, requirement_terms)]
    relevant = [
        a for a in verified
        if any(skill.lower() in (a.achievement_text + " " + " ".join(a.skills)).lower() for skill in requirement_terms)
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
    changes.extend(_role_gap_changes(session, proposal, job, user_id, requirement_terms, verified, resume.extracted_text or ""))
    used_ai = any(
        evidence.get("source") == "model"
        for change in changes
        for evidence in change.evidence
    )
    session.add_all(changes)
    session.add(TailoringAudit(
        proposal_id=proposal.id,
        event="proposal_created",
        details={"provider": "openai" if used_ai else "deterministic"},
    ))
    session.commit()
    if used_ai and user:
        record_ai_action(session, user)
    session.refresh(proposal)
    return proposal


ROLE_SECTION_PREFIX = "role:"


def role_section(employment_id: int) -> str:
    return f"{ROLE_SECTION_PREFIX}{employment_id}"


def _role_gap_changes(
    session: Session,
    proposal: TailoringProposal,
    job: Job,
    user_id: int,
    requirements: list[str],
    verified: list[Achievement],
    resume_text: str,
) -> list[TailoringChange]:
    """One pending change per (role, missing requirement): the question to
    answer and the bullet to use if the answer is yes."""
    employment = list(session.exec(select(Employment).where(Employment.user_id == user_id)))
    if not employment or not requirements:
        return []
    employment.sort(key=lambda row: (not row.is_current, -(row.start_date.toordinal() if row.start_date else 0)))
    roles = []
    for row in employment:
        linked = [a.achievement_text for a in verified if a.employer and row.employer and a.employer.casefold() == row.employer.casefold()]
        dates = " – ".join(value for value in (row.start_date.strftime("%b %Y") if row.start_date else "", "Present" if row.is_current else (row.end_date.strftime("%b %Y") if row.end_date else "")) if value)
        roles.append(RoleContext(employment_id=row.id or 0, employer=row.employer, title=row.job_title, dates=dates, text=row.description or "", bullets=linked))
    gaps = find_gaps(roles, list(dict.fromkeys(requirements)), resume_text)
    changes = []
    for gap in suggest_role_gaps(job.title, job.company, roles, gaps):
        changes.append(
            TailoringChange(
                proposal_id=proposal.id,
                section=role_section(gap.employment_id),
                original_text="",
                proposed_text=gap.suggestion,
                reason=gap.prompt,
                evidence=[{"type": "employment", "id": gap.employment_id, "employer": gap.employer, "title": gap.title, "requirement": gap.requirement, "source": gap.source}],
                immutable_tokens=[],
                confidence=0.6 if gap.source == "model" else 0.4,
            )
        )
    return changes


def review_all(session: Session, proposal: TailoringProposal, status: str, section_prefix: str | None = None) -> list[TailoringChange]:
    """Approve or reject every pending change at once (optionally only those
    in one section family, e.g. every role suggestion)."""
    if status not in {"accepted", "rejected"}:
        raise ValueError("Bulk review accepts or rejects")
    changes = list(session.exec(select(TailoringChange).where(TailoringChange.proposal_id == proposal.id)))
    touched = []
    for change in changes:
        if change.status != "pending":
            continue
        if section_prefix and not change.section.startswith(section_prefix):
            continue
        change.status = status
        change.edited_text = None
        change.reviewed_at = utcnow()
        session.add(change)
        touched.append(change)
    session.add(TailoringAudit(proposal_id=proposal.id, event="changes_reviewed_in_bulk", details={"status": status, "count": len(touched), "section_prefix": section_prefix}))
    session.commit()
    for change in touched:
        session.refresh(change)
    return touched


def review_change(session: Session, change: TailoringChange, status: str, edited_text: str | None) -> TailoringChange:
    if status not in {"accepted", "edited", "rejected"}:
        raise ValueError("Invalid review status")
    final_text = edited_text if status == "edited" else change.proposed_text
    if status != "rejected" and not preserves_immutable_facts(change.original_text, final_text or ""):
        raise ValueError("Dates, percentages, compensation, and metrics from the source must be preserved")
    change.status = status
    change.edited_text = edited_text if status == "edited" else None
    change.reviewed_at = utcnow()
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
    proposal.finalized_at = utcnow()
    session.add(proposal)
    session.add(TailoringAudit(proposal_id=proposal.id, event="proposal_finalized"))
    session.commit()
    session.refresh(proposal)
    return proposal
