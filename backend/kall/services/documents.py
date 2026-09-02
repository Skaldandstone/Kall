import contextlib
import hashlib
import io
import json
import zipfile
from collections.abc import Iterable
from datetime import datetime, timedelta

from docx import Document
from kall.clock import utcnow
from kall.models import (
    CoverLetterChange,
    CoverLetterProposal,
    DocumentArtifact,
    DocumentGenerationAudit,
    GeneratedDocument,
    Job,
    JobRequirementAnalysis,
    KeywordCoverageReport,
    TailoringChange,
    TailoringProposal,
)
from kall.services.storage import get_storage
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
from sqlmodel import Session, select

GENERATION_VERSION = "documents-v1"


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
    sections = finalized_resume_content(session, proposal)
    content_text = "\n\n".join(item["text"] for item in sections)
    canonical = json.dumps(sections, sort_keys=True).encode()
    generated = GeneratedDocument(
        user_id=proposal.user_id,
        proposal_id=proposal.id,
        job_id=proposal.job_id,
        resume_id=proposal.resume_id,
        document_type="resume",
        template_key=template_key,
        content_json={"sections": sections},
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
    job = session.get(Job, proposal.job_id)
    sections = finalized_resume_content(session, proposal)
    evidence = [item["text"] for item in sections if item["section"] == "achievement"][:2]
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
    paragraphs = [
        f"I am applying for the {job.title if job else 'position'} at {job.company if job else 'your organization'}.",
        " ".join(evidence) if evidence else "My verified experience aligns with the responsibilities described in the role.",
        company_interest_notes or "I would welcome the opportunity to discuss how my experience can support the team.",
    ]
    for position, text in enumerate(paragraphs):
        session.add(
            CoverLetterChange(
                proposal_id=letter.id,
                position=position,
                proposed_text=text,
                evidence=[{"source": "finalized_resume", "proposal_id": proposal.id}],
            )
        )
    session.commit()
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
    come back identical, which is the whole reason expiry is acceptable.
    """
    storage = get_storage()
    existing = session.exec(
        select(DocumentArtifact).where(
            DocumentArtifact.generated_document_id == document.id,
            DocumentArtifact.format == file_format,
        )
    ).first()
    if existing and storage.exists(existing.file_path):
        return existing

    data = render_artifact(document, file_format)
    key = f"generated/{document.user_id}/document-{document.id}/{document.document_type}.{file_format}"
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
