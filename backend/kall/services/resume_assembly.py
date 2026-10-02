"""Assemble a complete resume from the professional record.

A tailoring proposal only carries the sentences Kall proposed to change --
a summary paragraph and a handful of achievements. Exporting those alone
produced a "resume" that was a title, two headings, and two paragraphs.
The export the person actually sends has to be the whole document: contact
header, the tailored summary, every job with its dates and bullets, skills,
education, credentials -- pulled from the professional record they have
confirmed, with the tailored text applied on top.

When the record is empty (a brand-new account that only uploaded a file),
the parsed resume text stands in so the export is still a full document
rather than a fragment.
"""

import re
from datetime import date

from kall.models import (
    AwardHonor,
    CandidateProfile,
    Certification,
    Education,
    Employment,
    Language,
    Patent,
    Publication,
    ResumeDocument,
    Skill,
    User,
)
from kall.security import decrypt_sensitive
from kall.services.intelligence import parse_resume
from kall.services.resume import extract_resume_text, reflow_extracted_text
from kall.services.storage import get_storage
from sqlmodel import Session, select

Layout = dict[str, object]

_SECTION_TITLES = {
    "summary": "Summary",
    "experience": "Experience",
    "achievements": "Selected Achievements",
    "skills": "Skills",
    "education": "Education",
    "certifications": "Certifications",
    "awards": "Awards",
    "publications": "Publications",
    "patents": "Patents",
    "languages": "Languages",
    "projects": "Projects",
}

_BULLET_PREFIX = re.compile(r"^\s*[•●▪‣○◦\-*]\s*")
_MONTH = r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
_DATE_RANGE = re.compile(
    rf"\b(?P<dates>{_MONTH}\s+(?:19|20)\d{{2}}\s*[-–—]\s*(?:Present|{_MONTH}\s+(?:19|20)\d{{2}}))\s*$",
    re.IGNORECASE,
)


def _month_year(value: date | None) -> str:
    return value.strftime("%b %Y") if value else ""


def _date_range(start: date | None, end: date | None, current: bool) -> str:
    left = _month_year(start)
    right = "Present" if current else _month_year(end)
    if left and right:
        return f"{left} – {right}"
    return left or right


def _bullets_from_description(description: str | None) -> list[str]:
    if not description:
        return []
    lines = [line.strip().lstrip("•●▪‣-* ").strip() for line in description.replace("\r", "").split("\n")]
    lines = [line for line in lines if line]
    if len(lines) > 1:
        return lines
    # A single paragraph: split into sentences so each reads as a bullet.
    text = lines[0] if lines else ""
    parts = [part.strip() for part in text.replace(". ", ".\n").split("\n") if part.strip()]
    return parts if len(parts) > 1 else [text] if text else []


def _tidy_url(value: str | None) -> str | None:
    if not value:
        return None
    return value.strip().removeprefix("https://").removeprefix("http://").removeprefix("www.").rstrip("/")


def _contact_line(user: User, profile: CandidateProfile | None) -> list[str]:
    parts: list[str] = [user.email]
    if profile:
        phone = decrypt_sensitive(profile.phone_encrypted) if profile.phone_encrypted else None
        if phone:
            parts.append(phone)
        place = ", ".join(value for value in (profile.city, profile.state_region) if value)
        if place:
            parts.append(place)
        for url in (profile.linkedin_url, profile.github_url, *(profile.website_urls or [])[:1], *(profile.portfolio_urls or [])[:1]):
            tidy = _tidy_url(url)
            if tidy and tidy not in parts:
                parts.append(tidy)
    return parts


def _tailored(sections: list[dict[str, str]], *keys: str) -> list[str]:
    found: list[str] = []
    for item in sections:
        name = item["section"].casefold().replace("_", " ")
        if any(key in name for key in keys) and item["text"].strip():
            found.append(item["text"].strip())
    return found


def _parsed_fallback(resume: ResumeDocument | None) -> dict[str, list[str]]:
    if not resume or not (resume.extracted_text or "").strip():
        return {}
    # extracted_text is reflowed at upload time (services/resume.py), but a
    # resume uploaded before that shipped still has the old, un-reflowed
    # bytes on disk -- nothing ever repairs a ResumeDocument row itself.
    # Reflowing here on every read means an old upload renders correctly
    # without a migration, the same way the tailoring proposal GET repairs
    # stale TailoringChange rows.
    source_text = reflow_extracted_text(resume.extracted_text or "")
    parsed, _ = parse_resume(source_text)
    sections = parsed.get("sections", {})
    # Older uploads were extracted with pypdf's content-stream order. When
    # that flattened a designed resume, every visible heading and bullet can
    # be buried in `unclassified`, and changing the renderer cannot repair the
    # already-stored text. Re-read only those damaged uploads from their
    # retained source file using the current layout-preserving extractor.
    recognized_experience = sections.get("experience") or sections.get("professional experience") or sections.get("employment")
    if not recognized_experience and resume.file_path:
        try:
            storage = get_storage()
            if storage.exists(resume.file_path):
                repaired = extract_resume_text(storage.read(resume.file_path), resume.mime_type)
                if repaired.strip():
                    parsed, _ = parse_resume(repaired)
        except Exception:  # noqa: BLE001 - a stale source must not block an otherwise renderable stored record
            pass
    return parsed.get("sections", {})


def parsed_resume_sections(resume: ResumeDocument | None) -> dict[str, list[str]]:
    """Return repaired source sections for analysis as well as rendering."""
    return _parsed_fallback(resume)


def _normalized_line(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _fallback_bullets(lines: list[str]) -> list[str]:
    """Rejoin wrapped PDF lines while preserving visible bullet boundaries."""
    bullets: list[str] = []
    for raw in lines:
        line = _normalized_line(raw)
        if not line:
            continue
        starts_bullet = bool(_BULLET_PREFIX.match(line))
        text = _BULLET_PREFIX.sub("", line).strip()
        if starts_bullet or not bullets:
            bullets.append(text)
        else:
            bullets[-1] = f"{bullets[-1]} {text}".strip()
    return [item for item in bullets if item]


def _experience_header(line: str) -> dict[str, object] | None:
    match = _DATE_RANGE.search(line)
    if not match:
        return None
    heading = line[:match.start()].strip(" -–—|")
    parts = re.split(r"\s+[-–—]\s+", heading, maxsplit=1)
    if len(parts) != 2 or not all(parts):
        return None
    organization, title = parts
    return {
        "title": title.strip(),
        "organization": organization.strip(),
        "location": "",
        "dates": match.group("dates").strip(),
        "notes": [],
        "bullets": [],
    }


def _fallback_experience(lines: list[str]) -> tuple[list[dict[str, object]], list[str]]:
    """Turn an extracted Experience section into role rows and real bullets.

    PDF extraction wraps long bullets across several physical lines. Rendering
    those lines as independent paragraphs produced the dense wall of text seen
    on mobile. Role rows carry a date range; bullet glyphs start achievements;
    all other lines continue the current note or bullet.
    """
    entries: list[dict[str, object]] = []
    unstructured: list[str] = []
    current: dict[str, object] | None = None
    for raw in lines:
        line = _normalized_line(raw)
        if not line:
            continue
        starts_bullet = bool(_BULLET_PREFIX.match(line))
        text = _BULLET_PREFIX.sub("", line).strip()
        header = None if starts_bullet else _experience_header(text)
        if header:
            entries.append(header)
            current = header
            continue
        if current is None:
            if starts_bullet or not unstructured:
                unstructured.append(text)
            else:
                unstructured[-1] = f"{unstructured[-1]} {text}".strip()
            continue
        bullets = current["bullets"]
        notes = current["notes"]
        if starts_bullet:
            bullets.append(text)
        elif bullets:
            bullets[-1] = f"{bullets[-1]} {text}".strip()
        elif notes:
            notes[-1] = f"{notes[-1]} {text}".strip()
        else:
            notes.append(text)
    return entries, unstructured


def _fallback_skill_groups(lines: list[str]) -> list[dict[str, object]]:
    grouped: list[tuple[str, str]] = []
    for raw in lines:
        line = _normalized_line(raw)
        label, separator, values = line.partition(":")
        if separator and 1 < len(label) <= 40 and values.strip():
            grouped.append((label.strip(), values.strip()))
        elif grouped:
            old_label, old_values = grouped[-1]
            grouped[-1] = (old_label, f"{old_values} {line}".strip())
        elif line:
            grouped.append(("Core", line))
    return [
        {"label": label, "items": [item.strip() for item in values.split(",") if item.strip()]}
        for label, values in grouped
    ]


def _fallback_summary(lines: list[str]) -> list[str]:
    normalized = [_normalized_line(line) for line in lines if _normalized_line(line)]
    if not normalized:
        return []
    # The unclassified prefix of an uploaded resume is commonly name,
    # contact line, then a wrapped professional summary. Keep the prose and
    # discard only high-confidence header rows.
    if len(normalized[0].split()) <= 6 and not normalized[0].endswith((".", "!", "?")):
        normalized = normalized[1:]
    normalized = [
        line for line in normalized
        if not re.search(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b", line)
        and not re.search(r"\b\d{3}[-.) ]\d{3}[- ]\d{4}\b", line)
    ]
    return [" ".join(normalized)] if normalized else []


def assemble_resume(
    session: Session,
    user_id: int,
    tailored_sections: list[dict[str, str]],
    resume: ResumeDocument | None = None,
) -> Layout:
    """Build the full resume layout: header, summary, then every record
    section that has content, with tailored text applied to the summary and
    tailored achievements kept as their own section."""
    user = session.get(User, user_id)
    profile = session.exec(select(CandidateProfile).where(CandidateProfile.user_id == user_id)).first()
    employment = list(session.exec(select(Employment).where(Employment.user_id == user_id)))
    employment.sort(key=lambda row: (not row.is_current, -(row.start_date.toordinal() if row.start_date else 0)))
    education = list(session.exec(select(Education).where(Education.user_id == user_id)))
    education.sort(key=lambda row: -(row.graduation_date.toordinal() if row.graduation_date else 0))
    skills = list(session.exec(select(Skill).where(Skill.user_id == user_id)))
    certifications = [row for row in session.exec(select(Certification).where(Certification.user_id == user_id)) if row.status == "active"]
    awards = list(session.exec(select(AwardHonor).where(AwardHonor.user_id == user_id)))
    publications = list(session.exec(select(Publication).where(Publication.user_id == user_id)))
    patents = list(session.exec(select(Patent).where(Patent.user_id == user_id)))
    languages = list(session.exec(select(Language).where(Language.user_id == user_id)))
    fallback = _parsed_fallback(resume) if not employment else {}

    sections: list[dict[str, object]] = []

    tailored_summary = _tailored(tailored_sections, "summary")[:1]
    if tailored_summary:
        # A drafted summary was only ever split on a *double* newline, but a
        # model asked for "two to four sentences" (tailoring.py's prompt)
        # sometimes separates them with a single "\n" instead -- that whole
        # reply then became one long paragraphs[0] with the line breaks
        # embedded in it, which both the PDF and the web preview render as
        # one dense run-on paragraph, since neither preserves raw "\n" in a
        # single flowed line of text. Splitting on any run of newlines
        # turns each of the model's own line breaks into its own paragraph.
        summary_paragraphs = [part.strip() for part in re.split(r"\n+", tailored_summary[0]) if part.strip()]
    elif profile and profile.professional_summary and profile.professional_summary.strip():
        summary_paragraphs = [profile.professional_summary.strip()]
    elif fallback.get("summary"):
        summary_paragraphs = [" ".join(fallback["summary"])]
    elif fallback.get("unclassified"):
        summary_paragraphs = _fallback_summary(fallback["unclassified"])
    else:
        summary_paragraphs = []
    if summary_paragraphs:
        sections.append({"key": "summary", "title": _SECTION_TITLES["summary"], "paragraphs": summary_paragraphs})

    if employment:
        # Approved role suggestions ("role:<employment_id>") become bullets
        # under the job they were asked about.
        approved_by_role: dict[str, list[str]] = {}
        for item in tailored_sections:
            if item["section"].startswith("role:") and item["text"].strip():
                approved_by_role.setdefault(item["section"].split(":", 1)[1], []).append(item["text"].strip())
        entries = []
        for row in employment:
            entries.append({
                "title": row.job_title,
                "organization": row.employer,
                "location": row.location or "",
                "dates": _date_range(row.start_date, row.end_date, row.is_current),
                "bullets": [*_bullets_from_description(row.description), *approved_by_role.get(str(row.id), [])],
            })
        sections.append({"key": "experience", "title": _SECTION_TITLES["experience"], "entries": entries})
    else:
        lines = fallback.get("experience") or fallback.get("professional experience") or fallback.get("employment") or []
        # An accepted "experience_bullet" change has no addressable slot to
        # go in the way a "role:<id>" bullet has a real Employment row --
        # this unstructured fallback text is all there is, so the accepted
        # wording replaces the original verbatim, in place, wherever it
        # appears. A change whose original text isn't found (edited by hand
        # into something no longer verbatim, say) is silently skipped
        # rather than left to raise -- the source text winning is a safe
        # default here, not a bug worth failing the whole render over.
        for item in tailored_sections:
            if item["section"] == "experience_bullet" and item.get("original") and item["text"].strip():
                lines = [line.replace(item["original"], item["text"].strip(), 1) for line in lines]
        if lines:
            entries, unstructured = _fallback_experience(lines)
            section: dict[str, object] = {"key": "experience", "title": _SECTION_TITLES["experience"]}
            if unstructured:
                section["paragraphs"] = unstructured
            if entries:
                section["entries"] = entries
            sections.append(section)

    achievements = _tailored(tailored_sections, "achievement", "result", "project", "portfolio")
    if not achievements and fallback.get("career highlights"):
        achievements = _fallback_bullets(fallback["career highlights"])
    if achievements:
        sections.append({"key": "achievements", "title": _SECTION_TITLES["achievements"], "bullets": achievements})

    if skills:
        ordered = sorted(skills, key=lambda row: (not row.is_primary, (row.category or "~"), row.name.casefold()))
        groups: dict[str, list[str]] = {}
        for row in ordered:
            groups.setdefault(row.category or "Core", []).append(row.name)
        sections.append({"key": "skills", "title": _SECTION_TITLES["skills"], "groups": [{"label": label, "items": items} for label, items in groups.items()]})
    elif fallback.get("skills"):
        groups = _fallback_skill_groups(fallback["skills"])
        sections.append({"key": "skills", "title": _SECTION_TITLES["skills"], "groups": groups})

    if education:
        entries = []
        for row in education:
            degree = " in ".join(value for value in (row.degree, row.major) if value)
            details = []
            if row.minor:
                details.append(f"Minor in {row.minor}")
            if row.honors:
                details.append(", ".join(row.honors))
            entries.append({
                "title": degree or "Studies",
                "organization": row.institution,
                "location": ", ".join(value for value in (row.state_region, row.country) if value),
                "dates": row.graduation_date.strftime("%Y") if row.graduation_date else "",
                "bullets": details,
            })
        sections.append({"key": "education", "title": _SECTION_TITLES["education"], "entries": entries})
    elif fallback.get("education"):
        sections.append({"key": "education", "title": _SECTION_TITLES["education"], "paragraphs": fallback["education"]})

    if certifications:
        sections.append({"key": "certifications", "title": _SECTION_TITLES["certifications"], "bullets": [
            f"{row.name} — {row.issuing_organization}" + (f" ({row.obtained_on.year})" if row.obtained_on else "") for row in certifications
        ]})
    elif fallback.get("certifications"):
        sections.append({"key": "certifications", "title": _SECTION_TITLES["certifications"], "bullets": fallback["certifications"]})

    if awards:
        sections.append({"key": "awards", "title": _SECTION_TITLES["awards"], "bullets": [
            f"{row.name} — {row.issuing_organization}" + (f" ({row.received_on.year})" if row.received_on else "") for row in awards
        ]})
    if publications:
        sections.append({"key": "publications", "title": _SECTION_TITLES["publications"], "bullets": [
            row.title + (f", {row.organization_or_venue}" if row.organization_or_venue else "") + (f" ({row.published_on.year})" if row.published_on else "") for row in publications
        ]})
    if patents:
        sections.append({"key": "patents", "title": _SECTION_TITLES["patents"], "bullets": [
            row.title + (f" ({row.patent_number})" if row.patent_number else "") for row in patents
        ]})
    if languages:
        sections.append({"key": "languages", "title": _SECTION_TITLES["languages"], "paragraphs": [
            ", ".join(f"{row.name} ({str(row.speaking).split('.')[-1].replace('_', ' ').lower()})" for row in languages)
        ]})

    return {
        "name": user.full_name if user else "",
        "contact": _contact_line(user, profile) if user else [],
        "sections": sections,
    }


def layout_text(layout: Layout) -> str:
    """The layout as plain text, in reading order -- for the .txt export,
    keyword coverage, and on-screen review."""
    lines: list[str] = []
    if layout.get("name"):
        lines.append(str(layout["name"]))
    if layout.get("contact"):
        lines.append(" • ".join(str(part) for part in layout["contact"]))
    for section in layout.get("sections", []):  # type: ignore[union-attr]
        lines.append("")
        lines.append(str(section["title"]).upper())
        for paragraph in section.get("paragraphs", []):
            lines.append(str(paragraph))
        for bullet in section.get("bullets", []):
            lines.append(f"• {bullet}")
        for group in section.get("groups", []):
            lines.append(f"{group['label']}: {', '.join(group['items'])}")
        for entry in section.get("entries", []):
            head = " — ".join(value for value in (entry.get("organization"), entry.get("title")) if value)
            tail = " · ".join(value for value in (entry.get("location"), entry.get("dates")) if value)
            lines.append(f"{head}" + (f" ({tail})" if tail else ""))
            for note in entry.get("notes", []):
                lines.append(str(note))
            for bullet in entry.get("bullets", []):
                lines.append(f"• {bullet}")
    return "\n".join(lines).strip()
