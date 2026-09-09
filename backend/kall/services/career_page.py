"""Building and publishing a career page.

The rule that matters here: **this endpoint serves strangers.** Anything it
returns is public to anyone with the link, so every decision fails closed. A
source that is not on the allowlist renders nothing rather than guessing, and
the sensitive records -- EEO, work authorization, reference contact details --
have no source name at all, so they cannot be reached even by a malformed
section.
"""

import re
from typing import Any

from kall.clock import utcnow
from kall.models import (
    AwardHonor,
    CandidateProfile,
    CareerPage,
    CareerPageSection,
    Certification,
    ConsultingPractice,
    Education,
    Employment,
    Patent,
    ProfessionalMembership,
    Publication,
    Skill,
    SpeakingEngagement,
    Testimonial,
    User,
    VolunteerBoardService,
)
from kall.services.embeds import embed_frame_url, provider_for
from sqlmodel import Session, select

SLUG_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$")

#: Slugs that would collide with a real route, or imply Kall itself is speaking.
RESERVED_SLUGS = frozenset({
    "api", "app", "admin", "settings", "account", "billing", "sign-in", "sign-up",
    "login", "register", "dashboard", "search", "jobs", "applications", "profiles",
    "onboarding", "privacy", "privacy-policy", "demo", "support", "help", "about",
    "kall", "www", "mail", "static", "assets", "p",
})

#: The kinds a page can contain. `source` is what each one draws on, or None
#: when the user writes it themselves. Mirrors the structure that worked on the
#: hand-built page: an argument first, then evidence, then what comes next.
SECTION_KINDS: dict[str, str | None] = {
    "intro": None,
    "thesis": None,
    "history": "employment",
    "samples": None,
    "principles": None,
    "next": None,
    "skills": "skills",
    "education": "education",
    "certifications": "certifications",
    "awards": "awards",
    "publications": "publications",
    "speaking": "speaking",
    "testimonials": "testimonials",
    "patents": "patents",
    "memberships": "memberships",
    "service": "service",
    "custom": None,
}

#: Only these models can ever reach a public page. Anything absent here is
#: unreachable by construction rather than by a check someone might forget:
#: EEO, work authorization, reference contact details, phone, and address have
#: no entry, so no section can name them.
PUBLIC_SOURCES: dict[str, Any] = {
    "employment": Employment,
    "skills": Skill,
    "education": Education,
    "certifications": Certification,
    "awards": AwardHonor,
    "publications": Publication,
    "speaking": SpeakingEngagement,
    "testimonials": Testimonial,
    "patents": Patent,
    "memberships": ProfessionalMembership,
    "service": VolunteerBoardService,
}

#: What a new page starts as. Ordered to make an argument rather than to list
#: facts -- the positioning statement leads, the record supports it.
DEFAULT_SECTIONS: tuple[dict[str, Any], ...] = (
    {"kind": "intro", "title": "Introduction", "layout": "list"},
    {"kind": "thesis", "title": "What I'm looking for", "layout": "list"},
    {"kind": "history", "title": "Career history", "layout": "timeline"},
    {"kind": "samples", "title": "Built and shipped", "layout": "grid"},
    {"kind": "principles", "title": "How I work", "layout": "list"},
    {"kind": "skills", "title": "Skills and tooling", "layout": "grid"},
    {"kind": "next", "title": "What's next", "layout": "list"},
)


class SlugError(ValueError):
    """The requested slug cannot be used, with a reason worth showing."""


def validate_slug(slug: str) -> str:
    cleaned = (slug or "").strip().lower()
    if not SLUG_PATTERN.match(cleaned):
        raise SlugError(
            "Use 3-40 characters: lowercase letters, numbers and hyphens, "
            "starting and ending with a letter or number."
        )
    if cleaned in RESERVED_SLUGS:
        raise SlugError("That address is reserved. Try another.")
    return cleaned


def suggest_slug(session: Session, user: User) -> str:
    """A first slug from the user's name, made unique with a numeric suffix."""
    base = re.sub(r"[^a-z0-9]+", "-", (user.full_name or user.email or "profile").lower())
    base = re.sub(r"-+", "-", base).strip("-")[:32] or "profile"
    if len(base) < 3:
        base = f"{base}-page"
    candidate, n = base, 1
    while (
        candidate in RESERVED_SLUGS
        or session.exec(select(CareerPage).where(CareerPage.slug == candidate)).first()
    ):
        n += 1
        candidate = f"{base}-{n}"
    return candidate


def ensure_page(session: Session, user: User) -> CareerPage:
    """The user's page, created unpublished with the default sections."""
    page = session.exec(select(CareerPage).where(CareerPage.user_id == user.id)).first()
    if page:
        return page

    page = CareerPage(
        user_id=user.id,
        slug=suggest_slug(session, user),
        display_name=user.full_name,
        published=False,
    )
    session.add(page)
    session.commit()
    session.refresh(page)

    for position, spec in enumerate(DEFAULT_SECTIONS):
        session.add(
            CareerPageSection(
                user_id=user.id,
                career_page_id=page.id,
                position=position,
                source=SECTION_KINDS.get(spec["kind"]),
                **spec,
            )
        )
    session.commit()
    return page


def sections_for(session: Session, page: CareerPage, *, visible_only: bool = False) -> list[CareerPageSection]:
    statement = select(CareerPageSection).where(CareerPageSection.career_page_id == page.id)
    if visible_only:
        statement = statement.where(CareerPageSection.visible == True)  # noqa: E712
    return sorted(session.exec(statement), key=lambda row: (row.position, row.id or 0))


def _testimonials(session: Session, user_id: int) -> list[Testimonial]:
    """Only testimonials the author agreed to show, and the user approved.

    Four separate flags, all required. A testimonial names a real third party
    who consented to something specific; publishing one they did not clear for
    a profile would be the worst failure this feature could have -- which is
    exactly why `status == "approved"` is checked here directly rather than
    trusted from api_testimonials.py's own gate on include_on_profile. Two
    independent checks of the one thing that must never be wrong is the
    point, not redundancy to clean up.
    """
    rows = session.exec(select(Testimonial).where(Testimonial.user_id == user_id))
    return [
        row
        for row in rows
        if row.include_on_profile
        and row.permission_granted
        and row.withdrawn_at is None
        and row.status == "approved"
    ]


def _records(session: Session, user_id: int, source: str, item_ids: list[int]) -> list[Any]:
    if source == "testimonials":
        rows: list[Any] = _testimonials(session, user_id)
    else:
        model = PUBLIC_SOURCES.get(source)
        if model is None:
            # An unknown source renders nothing. A public page must not guess.
            return []
        rows = list(session.exec(select(model).where(model.user_id == user_id)))

    if not item_ids:
        return rows
    # Preserve the user's chosen order, and silently drop ids that no longer
    # exist -- a deleted record should not break the page.
    by_id = {row.id: row for row in rows}
    return [by_id[i] for i in item_ids if i in by_id]


def _public_fields(row: Any, source: str) -> dict[str, Any]:
    """Project a record down to what is safe to publish.

    Explicit allowlists per source rather than dumping the row: several of
    these models carry encrypted columns and internal flags that have no
    business on a public page.
    """
    fields: dict[str, tuple[str, ...]] = {
        "employment": ("employer", "job_title", "location", "start_date", "end_date", "is_current", "description"),
        "skills": ("name", "category", "proficiency", "years_experience", "is_primary"),
        "education": ("institution", "degree", "major", "minor", "graduation_date", "honors"),
        "certifications": ("name", "issuing_organization", "obtained_on", "expires_on", "verification_url"),
        "awards": ("name", "issuing_organization", "received_on", "description", "evidence_url"),
        "publications": ("kind", "title", "organization_or_venue", "published_on", "url", "co_authors"),
        "speaking": ("title", "event", "engagement_type", "occurred_on", "url", "description"),
        "testimonials": ("author_name", "author_title", "author_company", "relationship", "body"),
        "patents": ("title", "patent_number", "jurisdiction", "status", "filed_on", "granted_on", "url"),
        "memberships": ("organization", "membership_type", "member_since", "expires_on"),
        "service": ("organization", "role", "service_type", "started_on", "ended_on", "description"),
    }
    allowed = fields.get(source, ())
    out: dict[str, Any] = {"id": row.id}
    for name in allowed:
        value = getattr(row, name, None)
        out[name] = value.isoformat() if hasattr(value, "isoformat") else value
    return out


def render_public_page(session: Session, page: CareerPage) -> dict[str, Any]:
    """Everything a visitor is allowed to see. Contains no email or phone."""
    profile = session.exec(
        select(CandidateProfile).where(CandidateProfile.user_id == page.user_id)
    ).first()
    practice = session.exec(
        select(ConsultingPractice).where(
            ConsultingPractice.user_id == page.user_id,
            ConsultingPractice.available.is_(True),
        )
    ).first()

    sections = []
    for section in sections_for(session, page, visible_only=True):
        rendered: dict[str, Any] = {
            "kind": section.kind,
            "title": section.title,
            "body": section.body,
            "layout": section.layout,
            "items": [],
        }
        if section.source:
            records = _records(session, page.user_id, section.source, section.item_ids)
            if section.source == "skills" and not section.item_ids:
                # is_primary was collectible ("Highlight as a primary skill")
                # but nothing ever acted on it -- surface primaries first
                # unless the user has already hand-ordered this section,
                # which is a stronger, more specific signal than the flag.
                records = sorted(records, key=lambda row: not row.is_primary)
            rendered["items"] = [_public_fields(row, section.source) for row in records]
        # Work samples. The frame URL is built here, from the provider template
        # and the stored id, so the renderer never constructs one out of
        # user-supplied text -- see services/embeds.py.
        samples = (section.options or {}).get("samples") or []
        if samples:
            rendered["samples"] = [
                {
                    "title": sample.get("title", ""),
                    "caption": sample.get("caption", ""),
                    "provider": sample.get("provider", "link"),
                    "url": sample.get("url", ""),
                    "frame_url": embed_frame_url(sample),
                    "aspect_ratio": (
                        provider.aspect_ratio if (provider := provider_for(str(sample.get("provider", "")))) else None
                    ),
                }
                for sample in samples
            ]
        sections.append(rendered)

    return {
        "slug": page.slug,
        "display_name": page.display_name,
        "headline": page.headline,
        "summary": page.summary,
        "location": page.location,
        "theme": page.theme,
        "links": page.links,
        # Deliberately the professional summary only. Nothing from the identity
        # profile that could identify where this person lives or how to call
        # them reaches this payload.
        "professional_summary": profile.professional_summary if profile else None,
        "consulting": ({
            "engagement_types": practice.engagement_types,
            "rate_cents": practice.rate_cents,
            "rate_basis": practice.rate_basis,
            "currency": practice.currency,
            "availability_note": practice.availability_note,
            "agreement_url": practice.agreement_url,
        } if practice else None),
        "sections": sections,
    }


def publish(page: CareerPage, published: bool) -> CareerPage:
    page.published = published
    if published and page.published_at is None:
        page.published_at = utcnow()
    return page
