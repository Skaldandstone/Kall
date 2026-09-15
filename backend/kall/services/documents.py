import contextlib
import hashlib
import io
import json
import zipfile
from collections.abc import Iterable
from datetime import datetime, timedelta

from docx import Document
from kall.clock import utcnow
from kall.config import get_settings
from kall.models import (
    CoverLetterChange,
    CoverLetterProposal,
    DocumentArtifact,
    DocumentGenerationAudit,
    GeneratedDocument,
    Job,
    JobRequirementAnalysis,
    KeywordCoverageReport,
    ResumeDocument,
    TailoringChange,
    TailoringProposal,
    User,
)
from kall.services.openai_json import ask_for_json
from kall.services.quota import assert_ai_allowed, record_ai_action
from kall.services.resume_assembly import assemble_resume, layout_text
from kall.services.resume_render import RENDER_VERSION, render_docx, render_pdf
from kall.services.storage import get_storage
from kall.services.tailoring import immutable_tokens
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
from sqlmodel import Session, select

GENERATION_VERSION = "documents-v1"

RESUME_TEMPLATE_KEYS = {
    "standard",
    "executive",
    "creative",
    "commercial",
    "service",
    "early",
    "compact",
    # Keep documents created by the original UI reproducible.
    "technical-leadership",
}

_TEMPLATE_SECTION_PRIORITIES: dict[str, tuple[str, ...]] = {
    "standard": ("summary", "experience", "achievement", "skill", "education"),
    "executive": ("summary", "achievement", "experience", "skill", "education"),
    "technical-leadership": ("summary", "achievement", "skill", "experience", "education"),
    "creative": ("summary", "project", "portfolio", "achievement", "experience", "skill", "education"),
    "commercial": ("summary", "achievement", "result", "experience", "skill", "education"),
    "service": ("summary", "skill", "training", "certification", "experience", "education"),
    "early": ("summary", "skill", "project", "experience", "education"),
    "compact": ("summary", "achievement", "experience", "skill", "education"),
}


def _ordered_sections(sections: list[dict[str, str]], template_key: str) -> list[dict[str, str]]:
    """Apply the selected content emphasis while preserving unknown sections."""
    if template_key not in RESUME_TEMPLATE_KEYS:
        raise ValueError("Choose one of the available resume layouts")
    priorities = _TEMPLATE_SECTION_PRIORITIES[template_key]

    def rank(item: tuple[int, dict[str, str]]) -> tuple[int, int]:
        original_index, section = item
        normalized = section["section"].casefold().replace("_", " ")
        for priority, term in enumerate(priorities):
            if term in normalized:
                return priority, original_index
        return len(priorities), original_index

    return [section for _, section in sorted(enumerate(sections), key=rank)]


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _accepted_text(change: TailoringChange) -> str | None:
    if change.status == "accepted":
        return change.proposed_text
    if change.status == "edited":
        return change.edited_text
    return None


def finalized_resume_content(session: Session, proposal: TailoringProposal) -> list[dict[str, str]]:
    if proposal.status != "finalized" or not proposal.finalized_at:
        raise ValueError("Tailoring proposal must be finalized before document generation")
    changes = list(
        session.exec(
            select(TailoringChange)
            .where(TailoringChange.proposal_id == proposal.id)
            .order_by(TailoringChange.id)
        )
    )
    if any(change.status == "pending" for change in changes):
        raise ValueError("Every tailoring change must be reviewed")
    return [
        {"section": change.section, "text": text}
        for change in changes
        if (text := _accepted_text(change))
    ]


def draft_resume_content(session: Session, proposal: TailoringProposal) -> list[dict[str, str]]:
    """The tailored sections as they stand right now -- accepted and edited
    changes only, pending ones left out -- so a look can be previewed before
    the review is finished."""
    changes = list(session.exec(select(TailoringChange).where(TailoringChange.proposal_id == proposal.id).order_by(TailoringChange.id)))
    return [{"section": change.section, "text": text} for change in changes if (text := _accepted_text(change))]


def preview_layout(session: Session, proposal: TailoringProposal, template_key: str) -> dict:
    sections = _ordered_sections(draft_resume_content(session, proposal), template_key)
    return assemble_resume(session, proposal.user_id, sections, session.get(ResumeDocument, proposal.resume_id))


def render_preview_png(layout: dict, template_key: str, dpi: int = 96) -> bytes:
    """First page of the PDF as a PNG, for choosing a look on screen."""
    import pymupdf

    pdf = render_pdf(layout, template_key)
    with pymupdf.open(stream=pdf, filetype="pdf") as document:
        return document[0].get_pixmap(dpi=dpi).tobytes("png")


def ensure_preview(session: Session, proposal: TailoringProposal, template_key: str) -> bytes:
    """Rendered on demand and cached by content, so re-opening the picker
    costs nothing and a review decision invalidates the old image.

    The digest folds in RENDER_VERSION alongside layout/template content --
    without it, a fix to render_pdf/render_preview_png would never actually
    reach a preview whose layout+template combination was already cached
    under the pre-fix key.
    """
    layout = preview_layout(session, proposal, template_key)
    digest = _sha(json.dumps({"layout": layout, "template": template_key, "render_version": RENDER_VERSION}, sort_keys=True).encode())[:24]
    key = f"previews/{proposal.user_id}/proposal-{proposal.id}/{template_key}-{digest}.png"
    storage = get_storage()
    if storage.exists(key):
        return storage.read(key)
    data = render_preview_png(layout, template_key)
    storage.save(key, data)
    return data


def document_preview_png(session: Session, document: GeneratedDocument) -> bytes:
    """Same caching shape as ensure_preview, keyed by RENDER_VERSION rather
    than a content digest since a saved document's layout never changes --
    the version alone is enough to invalidate it across a rendering fix."""
    layout = document.content_json.get("layout")
    if not layout:
        raise ValueError("This document has no layout to preview")
    key = f"previews/{document.user_id}/document-{document.id}-v{RENDER_VERSION}.png"
    storage = get_storage()
    if storage.exists(key):
        return storage.read(key)
    data = render_preview_png(layout, document.template_key)
    storage.save(key, data)
    return data


def save_document_to_profile(session: Session, document: GeneratedDocument, job: Job | None) -> ResumeDocument:
    """File the generated resume in the person's resume library as its own
    document, so it can be selected for future applications and appears in
    the studio like an upload would."""
    layout = document.content_json.get("layout") or {}
    pdf = ensure_artifact(session, document, "pdf")
    storage = get_storage()
    data = storage.read(pdf.file_path)
    label = f"{job.company} – {job.title}" if job else f"Tailored resume {document.id}"
    key = f"uploads/{document.user_id}/tailored-{document.id}.pdf"
    storage.save(key, data)
    resume = ResumeDocument(
        user_id=document.user_id,
        name=f"{label} (tailored).pdf",
        file_path=key,
        mime_type="application/pdf",
        byte_size=len(data),
        tags=["tailored", document.template_key],
        target_titles=[job.title] if job else [],
        extracted_text=layout_text(layout) if layout else "\n\n".join(item["text"] for item in document.content_json.get("sections", [])),
    )
    session.add(resume)
    session.add(DocumentGenerationAudit(user_id=document.user_id, generated_document_id=document.id, event="saved_to_profile", details={"resume_name": resume.name}))
    session.commit()
    session.refresh(resume)
    return resume


def keyword_report(
    session: Session,
    generated: GeneratedDocument,
    job_id: int,
    content: str,
) -> KeywordCoverageReport:
    analysis = session.exec(
        select(JobRequirementAnalysis).where(JobRequirementAnalysis.job_id == job_id)
    ).first()
    required = analysis.required_skills if analysis else []
    preferred = analysis.preferred_skills if analysis else []
    lowered = content.lower()
    required_covered = [term for term in required if term.lower() in lowered]
    preferred_covered = [term for term in preferred if term.lower() in lowered]
    unsupported = [term for term in required + preferred if term.lower() not in lowered]
    return KeywordCoverageReport(
        generated_document_id=generated.id,
        required_covered=required_covered,
        preferred_covered=preferred_covered,
        unsupported=list(dict.fromkeys(unsupported)),
        required_percent=round(100 * len(required_covered) / len(required)) if required else 100,
        preferred_percent=round(100 * len(preferred_covered) / len(preferred)) if preferred else 100,
    )


#: A fixed timestamp for everything that would otherwise record "now".
#:
#: Rendering has to be reproducible: the product shows a checksum and calls
#: these artifacts traceable, and a checksum nobody can recompute is
#: decoration. It also lets an expired artifact be rebuilt and shown to be the
#: same file, which is what makes expiry safe rather than lossy.
_FIXED_TIMESTAMP = datetime(2020, 1, 1)
_FIXED_ZIP_DATE = (2020, 1, 1, 0, 0, 0)


def _normalize_zip(data: bytes) -> bytes:
    """Rewrite a zip's entry timestamps to a fixed date.

    A .docx is a zip. python-docx stamps each entry with the wall clock at
    save time, so two renders of identical content differ in the archive
    headers even though every byte of every entry matches. Order, compression
    and attributes are preserved -- only the dates change.
    """
    source = zipfile.ZipFile(io.BytesIO(data))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as target:
        for info in source.infolist():
            replacement = zipfile.ZipInfo(info.filename, date_time=_FIXED_ZIP_DATE)
            replacement.compress_type = info.compress_type
            replacement.external_attr = info.external_attr
            target.writestr(replacement, source.read(info.filename))
    return out.getvalue()


def _write_docx(title: str, sections: Iterable[dict[str, str]]) -> bytes:
    document = Document()
    document.add_heading(title, 0)
    for item in sections:
        document.add_heading(item["section"].replace("_", " ").title(), level=1)
        document.add_paragraph(item["text"])
    # Core properties record created/modified/revision; pin them so the only
    # thing the bytes depend on is the content.
    properties = document.core_properties
    properties.created = _FIXED_TIMESTAMP
    properties.modified = _FIXED_TIMESTAMP
    properties.last_modified_by = ""
    properties.revision = 1
    buffer = io.BytesIO()
    document.save(buffer)
    return _normalize_zip(buffer.getvalue())


def _write_pdf(title: str, sections: Iterable[dict[str, str]]) -> bytes:
    styles = getSampleStyleSheet()
    story = [Paragraph(title, styles["Title"]), Spacer(1, 18)]
    for item in sections:
        story.extend(
            [
                Paragraph(item["section"].replace("_", " ").title(), styles["Heading2"]),
                Paragraph(item["text"], styles["BodyText"]),
                Spacer(1, 12),
            ]
        )
    buffer = io.BytesIO()
    # invariant=1 drops the embedded creation date and document id, which are
    # the only non-deterministic parts of a reportlab PDF.
    SimpleDocTemplate(buffer, pagesize=LETTER, title=title, invariant=1).build(story)
    return buffer.getvalue()


def generate_resume_documents(
    session: Session,
    proposal: TailoringProposal,
    template_key: str = "standard",
) -> GeneratedDocument:
    sections = _ordered_sections(finalized_resume_content(session, proposal), template_key)
    # The tailored sections are what changed; the layout is the whole
    # resume they are applied to (header, every job, skills, education) --
    # the document a person actually sends.
    layout = assemble_resume(session, proposal.user_id, sections, session.get(ResumeDocument, proposal.resume_id))
    content_text = "\n\n".join([layout_text(layout), *(item["text"] for item in sections)])
    canonical = json.dumps({"sections": sections, "layout": layout}, sort_keys=True).encode()
    generated = GeneratedDocument(
        user_id=proposal.user_id,
        proposal_id=proposal.id,
        job_id=proposal.job_id,
        resume_id=proposal.resume_id,
        document_type="resume",
        template_key=template_key,
        content_json={"sections": sections, "layout": layout},
        checksum=_sha(canonical),
        # finalized_at was already set here; status defaulted to "generated"
        # and nothing anywhere ever advanced it. build_preview() (in
        # services/submissions.py) filters on status == "finalized" to build
        # the submission preview's document_checksums -- with this never set,
        # that dict was always empty, and the anti-tampering check comparing
        # a submission's approved document_checksums against the current
        # ones (validate_submission) was comparing {} to {} and could never
        # actually catch a resume that changed after approval.
        status="finalized",
        finalized_at=utcnow(),
    )
    session.add(generated)
    session.commit()
    session.refresh(generated)

    # Nothing is rendered here. Every generation used to write txt, docx and
    # pdf immediately, three files for a document most people download in at
    # most one format -- and often none, because the coverage report is what
    # they came to look at. Rendering is deterministic and cheap, so it now
    # happens on the first download of each format instead. See ensure_artifact.
    report = keyword_report(session, generated, proposal.job_id, content_text)
    session.add(report)
    session.add(
        DocumentGenerationAudit(
            user_id=proposal.user_id,
            generated_document_id=generated.id,
            event="resume_generated",
            details={"template": template_key, "generation_version": GENERATION_VERSION},
        )
    )
    session.commit()
    session.refresh(generated)
    return generated


#: Achievements mentioning these read as leadership/scope, not hands-on
#: delivery -- used to pick which evidence an "executive" emphasis leads
#: with, since the professional record doesn't tag achievements by kind.
_LEADERSHIP_WORDS = ("led", "lead", "manage", "managed", "director", "strategy", "team", "organization", "executive")

_TONE_OPENERS = {
    "formal": "I am writing to apply for the {title} role at {company}.",
    "conversational": "I'd love to be considered for the {title} opening at {company}.",
}
_TONE_CLOSERS = {
    "formal": "I would welcome the opportunity to discuss how my experience can support the team.",
    "conversational": "I'd love to talk more about how I could help the team.",
}

_COVER_LETTER_SCHEMA = {
    "type": "object",
    "properties": {
        "paragraphs": {
            "type": "array",
            "minItems": 3,
            "maxItems": 4,
            "items": {"type": "string"},
        }
    },
    "required": ["paragraphs"],
    "additionalProperties": False,
}


def _matched_requirements(analysis: JobRequirementAnalysis | None, resume_text: str) -> list[str]:
    if not analysis:
        return []
    lowered = resume_text.lower()
    matched = [term for term in [*analysis.required_skills, *analysis.preferred_skills] if term.lower() in lowered]
    return list(dict.fromkeys(matched))[:4]


def _select_evidence(achievements: list[str], summary: str, emphasis: str, analysis: JobRequirementAnalysis | None, limit: int) -> list[str]:
    pool = achievements or ([summary] if summary else [])
    if not pool:
        return []
    if emphasis == "technical" and analysis:
        skills = {s.lower() for s in [*analysis.required_skills, *analysis.preferred_skills]}
        ranked = sorted(pool, key=lambda text: -sum(1 for skill in skills if skill in text.lower()))
    elif emphasis == "executive":
        ranked = sorted(pool, key=lambda text: -sum(1 for word in _LEADERSHIP_WORDS if word in text.lower()))
    else:
        ranked = pool
    return ranked[:limit]


def _rules_based_paragraphs(
    job: Job | None,
    analysis: JobRequirementAnalysis | None,
    sections: list[dict[str, str]],
    emphasis: str,
    tone: str,
    length: str,
    company_interest_notes: str | None,
) -> list[str]:
    achievements = [item["text"].strip() for item in sections if item["section"] == "achievement" and item["text"].strip()]
    summary = next((item["text"].strip() for item in sections if item["section"] == "summary"), "")
    resume_text = " ".join(item["text"] for item in sections if item["text"].strip())
    matched = _matched_requirements(analysis, resume_text)

    opener = _TONE_OPENERS.get(tone, _TONE_OPENERS["formal"]).format(
        title=job.title if job else "this position", company=job.company if job else "your organization"
    )
    if matched:
        opener += f" The posting's emphasis on {', '.join(matched)} lines up directly with my background."

    lead_count = 1 if length == "concise" else 2
    evidence = _select_evidence(achievements, summary, emphasis, analysis, lead_count)
    paragraphs = [
        opener,
        " ".join(evidence) if evidence else "My verified experience aligns with the responsibilities described in the role.",
    ]
    if length != "concise" and len(achievements) > lead_count:
        extra = [text for text in achievements if text not in evidence][:1]
        if extra:
            paragraphs.append(extra[0])
    paragraphs.append(company_interest_notes or _TONE_CLOSERS.get(tone, _TONE_CLOSERS["formal"]))
    return paragraphs


def _drafted_paragraphs(
    job: Job | None,
    analysis: JobRequirementAnalysis | None,
    sections: list[dict[str, str]],
    emphasis: str,
    tone: str,
    length: str,
    company_interest_notes: str | None,
) -> tuple[list[str], bool]:
    """Grounded in the actual posting and the person's own finalized resume
    content when a model is configured; a rules-based letter that still
    reflects the emphasis/tone/length choices otherwise. Neither path
    invents experience -- the model is only given the finalized resume text
    to draw evidence from, the same "never invent" boundary role_gaps.py
    enforces for resume bullets."""
    if get_settings().openai_api_key and job:
        resume_text = layout_text({"name": "", "contact": [], "sections": [
            {"key": item["section"], "title": item["section"], "paragraphs": [item["text"]]} for item in sections if item["text"].strip()
        ]})
        all_requirements = (analysis.required_skills if analysis else []) + (analysis.preferred_skills if analysis else [])
        requirements = ", ".join(all_requirements[:10]) or "not specified"
        prompt = (
            f"Write a cover letter for '{job.title}' at {job.company}.\n"
            f"Job description: {job.description[:3000]}\n"
            f"Key requirements: {requirements}\n"
            f"The applicant's finalized, verified resume content (do not claim anything beyond this):\n{resume_text[:3000]}\n"
            f"Emphasis: {emphasis}. Tone: {tone}. Length: {length} ('concise' means 3 short paragraphs, otherwise 3-4).\n"
            + (f"The applicant specifically wants to mention: {company_interest_notes}\n" if company_interest_notes else "")
            + "Return an opening paragraph naming the role and company, one or two body paragraphs citing specific, "
            "true evidence from the resume content tied to the posting's own requirements, and a closing paragraph. "
            "Never invent metrics, employers, titles, or skills not present in the resume content above."
        )
        result = ask_for_json(
            prompt,
            schema_name="cover_letter",
            schema=_COVER_LETTER_SCHEMA,
            purpose="cover letter draft",
            source_ref=f"job:{job.id}",
        )
        paragraphs = [str(p).strip() for p in (result or {}).get("paragraphs", []) if str(p).strip()]
        source_numbers = immutable_tokens(
            " ".join((resume_text, job.description, company_interest_notes or ""))
        )
        drafted_numbers = immutable_tokens(" ".join(paragraphs))
        if len(paragraphs) >= 3 and set(drafted_numbers).issubset(source_numbers):
            return paragraphs, True
    return (
        _rules_based_paragraphs(
            job, analysis, sections, emphasis, tone, length, company_interest_notes
        ),
        False,
    )


def propose_cover_letter(
    session: Session,
    proposal: TailoringProposal,
    emphasis: str,
    tone: str,
    length: str,
    company_interest_notes: str | None,
) -> CoverLetterProposal:
    if proposal.status != "finalized":
        raise ValueError("Finalize the resume tailoring proposal first")
    user = session.get(User, proposal.user_id)
    if get_settings().openai_api_key and user:
        assert_ai_allowed(session, user)
    job = session.get(Job, proposal.job_id)
    analysis = session.exec(select(JobRequirementAnalysis).where(JobRequirementAnalysis.job_id == proposal.job_id)).first()
    sections = finalized_resume_content(session, proposal)
    letter = CoverLetterProposal(
        user_id=proposal.user_id,
        job_id=proposal.job_id,
        tailoring_proposal_id=proposal.id,
        emphasis=emphasis,
        tone=tone,
        length=length,
        company_interest_notes=company_interest_notes,
    )
    session.add(letter)
    session.commit()
    session.refresh(letter)
    paragraphs, used_ai = _drafted_paragraphs(
        job, analysis, sections, emphasis, tone, length, company_interest_notes
    )
    for position, text in enumerate(paragraphs):
        session.add(
            CoverLetterChange(
                proposal_id=letter.id,
                position=position,
                proposed_text=text,
                evidence=[{
                    "source": "finalized_resume",
                    "proposal_id": proposal.id,
                    "generation": "openai" if used_ai else "deterministic",
                }],
            )
        )
    session.commit()
    if used_ai and user:
        record_ai_action(session, user)
    session.refresh(letter)
    return letter


def review_cover_letter_change(
    session: Session,
    change: CoverLetterChange,
    decision: str,
    edited_text: str | None = None,
) -> CoverLetterChange:
    if decision not in {"accepted", "edited", "rejected"}:
        raise ValueError("Invalid decision")
    if decision == "edited" and not edited_text:
        raise ValueError("Edited text is required")
    change.status = decision
    change.edited_text = edited_text if decision == "edited" else None
    change.reviewed_at = utcnow()
    session.add(change)
    session.commit()
    session.refresh(change)
    return change


def finalize_cover_letter(session: Session, proposal: CoverLetterProposal) -> CoverLetterProposal:
    changes = list(session.exec(select(CoverLetterChange).where(CoverLetterChange.proposal_id == proposal.id)))
    if not changes or any(change.status == "pending" for change in changes):
        raise ValueError("Every cover letter paragraph must be reviewed")
    proposal.status = "finalized"
    proposal.finalized_at = utcnow()
    session.add(proposal)
    session.commit()
    session.refresh(proposal)
    return proposal


# --- Rendering on demand, and letting rendered files expire -----------------
#
# A generated document is two things kept apart on purpose:
#
#   GeneratedDocument.content_json  the tailored content, in Postgres. Small,
#                                   derived from an AI call, and the thing
#                                   that would be expensive to lose.
#   DocumentArtifact                a rendered txt/docx/pdf in object storage.
#                                   Derived from content_json by pure
#                                   templating -- no model call, no quota
#                                   consumed, byte-for-byte reproducible.
#
# Because the second is reproducible from the first, artifacts are disposable.
# They are rendered when someone asks for one and deleted when they go stale;
# the record of what was generated never expires.

#: Formats a generated document can be produced in.
ARTIFACT_FORMATS: dict[str, str] = {
    "txt": "text/plain",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
}

#: How long a rendered file is kept after it was last produced.
#:
#: Not a cost control -- at any plausible scale these files are a few dollars a
#: month. It is a data-retention rule: they contain someone's employment
#: history, and keeping them forever with no expiry is a liability rather than
#: a feature. Twelve months is long enough that nobody loses something they
#: still care about, and re-rendering returns the identical file anyway.
ARTIFACT_RETENTION_DAYS = 365


def _document_title(document: GeneratedDocument) -> str:
    return "Tailored Resume" if document.document_type == "resume" else "Cover Letter"


def render_artifact(document: GeneratedDocument, file_format: str) -> bytes:
    """Produce one format from the stored content. Deterministic."""
    if file_format not in ARTIFACT_FORMATS:
        raise ValueError(f"Unsupported format: {file_format}")
    sections = document.content_json.get("sections", [])
    layout = document.content_json.get("layout") if document.document_type == "resume" else None
    if layout:
        if file_format == "txt":
            return layout_text(layout).encode("utf-8")
        if file_format == "docx":
            return _normalize_zip(render_docx(layout, document.template_key))
        return render_pdf(layout, document.template_key)
    if file_format == "txt":
        return "\n\n".join(item["text"] for item in sections).encode("utf-8")
    title = _document_title(document)
    if file_format == "docx":
        return _write_docx(title, sections)
    return _write_pdf(title, sections)


def ensure_artifact(
    session: Session,
    document: GeneratedDocument,
    file_format: str,
) -> DocumentArtifact:
    """Return the rendered artifact, producing it if it is absent or expired.

    Safe to call for a document whose files were expired years ago: the bytes
    come back identical, which is the whole reason expiry is acceptable --
    *identical to what the current renderer produces*, not to whatever was
    generated originally. The storage key folds in RENDER_VERSION for
    exactly that reason: without it, `existing`'s row (and the file at its
    `file_path`) would keep satisfying `storage.exists(...)` forever, so a
    resume/cover-letter generated before a rendering bug fix would keep
    serving the pre-fix bytes on every future download indefinitely, no
    matter how many times the renderer itself gets fixed afterward.
    """
    storage = get_storage()
    key = f"generated/{document.user_id}/document-{document.id}/{document.document_type}-v{RENDER_VERSION}.{file_format}"
    existing = session.exec(
        select(DocumentArtifact).where(
            DocumentArtifact.generated_document_id == document.id,
            DocumentArtifact.format == file_format,
        )
    ).first()
    if existing and existing.file_path == key and storage.exists(existing.file_path):
        return existing

    data = render_artifact(document, file_format)
    storage.save(key, data)

    artifact = existing or DocumentArtifact(
        generated_document_id=document.id,
        format=file_format,
        file_path=key,
        mime_type=ARTIFACT_FORMATS[file_format],
        byte_size=len(data),
        checksum=_sha(data),
    )
    # Re-rendering an expired file: the row is reused so the checksum recorded
    # when it was first generated stays put, and a mismatch would be a real
    # signal rather than an artifact of the clock.
    artifact.file_path = key
    artifact.byte_size = len(data)
    artifact.mime_type = ARTIFACT_FORMATS[file_format]
    session.add(artifact)
    session.commit()
    session.refresh(artifact)
    return artifact


def offered_artifacts(session: Session, document: GeneratedDocument) -> list[dict[str, object]]:
    """Every format on offer, with a size for the ones already rendered.

    The product lists formats to download; whether a file happens to exist yet
    is an implementation detail, so all three are always offered.
    """
    rendered = {
        row.format: row
        for row in session.exec(
            select(DocumentArtifact).where(
                DocumentArtifact.generated_document_id == document.id
            )
        )
    }
    return [
        {
            "id": rendered[fmt].id if fmt in rendered else None,
            "format": fmt,
            "mime_type": mime,
            "byte_size": rendered[fmt].byte_size if fmt in rendered else None,
            "checksum": rendered[fmt].checksum if fmt in rendered else None,
        }
        for fmt, mime in ARTIFACT_FORMATS.items()
    ]


def expire_artifacts(session: Session, older_than_days: int = ARTIFACT_RETENTION_DAYS) -> int:
    """Delete rendered files older than the retention window.

    Deletes the stored object and the row that describes it. The
    GeneratedDocument is untouched, so the document remains listed,
    downloadable, and identical when someone asks for it again.

    Returns the number of artifacts removed.
    """
    cutoff = utcnow() - timedelta(days=older_than_days)
    storage = get_storage()
    stale = list(
        session.exec(select(DocumentArtifact).where(DocumentArtifact.created_at < cutoff))
    )
    for artifact in stale:
        # A file already gone is the desired end state; the row still goes.
        with contextlib.suppress(Exception):
            storage.delete(artifact.file_path)
        session.delete(artifact)
    session.commit()
    return len(stale)
