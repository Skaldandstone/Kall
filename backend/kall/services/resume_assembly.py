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
from kall.services.resume import reflow_extracted_text
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
    parsed, _ = parse_resume(reflow_extracted_text(resume.extracted_text or ""))
    return parsed.get("sections", {})


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
        summary_paragraphs = [part.strip() for part in tailored_summary[0].split("\n\n") if part.strip()]
    elif profile and profile.professional_summary and profile.professional_summary.strip():
        summary_paragraphs = [profile.professional_summary.strip()]
    elif fallback.get("summary"):
        summary_paragraphs = [" ".join(fallback["summary"])]
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
        if lines:
            sections.append({"key": "experience", "title": _SECTION_TITLES["experience"], "paragraphs": lines})

    achievements = _tailored(tailored_sections, "achievement", "result", "project", "portfolio")
    if achievements:
        sections.append({"key": "achievements", "title": _SECTION_TITLES["achievements"], "bullets": achievements})

    if skills:
        ordered = sorted(skills, key=lambda row: (not row.is_primary, (row.category or "~"), row.name.casefold()))
        groups: dict[str, list[str]] = {}
        for row in ordered:
            groups.setdefault(row.category or "Core", []).append(row.name)
        sections.append({"key": "skills", "title": _SECTION_TITLES["skills"], "groups": [{"label": label, "items": items} for label, items in groups.items()]})
    elif fallback.get("skills"):
        sections.append({"key": "skills", "title": _SECTION_TITLES["skills"], "paragraphs": [", ".join(fallback["skills"])]})

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
            head = " — ".join(value for value in (entry.get("title"), entry.get("organization")) if value)
            tail = " · ".join(value for value in (entry.get("location"), entry.get("dates")) if value)
            lines.append(f"{head}" + (f" ({tail})" if tail else ""))
            for bullet in entry.get("bullets", []):
                lines.append(f"• {bullet}")
    return "\n".join(lines).strip()
