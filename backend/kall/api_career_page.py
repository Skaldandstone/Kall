from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.db import get_session
from kall.models import CareerPage, CareerPageSection, User
from kall.services.career_page import (
    SECTION_KINDS,
    SlugError,
    ensure_page,
    publish,
    render_public_page,
    sections_for,
    validate_slug,
)

router = APIRouter(tags=["career-page"])


class PageUpdate(BaseModel):
    slug: str | None = None
    published: bool | None = None
    display_name: str | None = None
    headline: str | None = None
    summary: str | None = None
    location: str | None = None
    theme: str | None = None
    links: list[dict[str, str]] | None = None


class SectionCreate(BaseModel):
    kind: str
    title: str
    body: str | None = None
    layout: str = "list"
    item_ids: list[int] = Field(default_factory=list)
    options: dict[str, Any] = Field(default_factory=dict)


class SectionUpdate(BaseModel):
    title: str | None = None
    body: str | None = None
    layout: str | None = None
    visible: bool | None = None
    item_ids: list[int] | None = None
    options: dict[str, Any] | None = None


class SectionOrder(BaseModel):
    #: Every section id on the page, in the order they should appear.
    section_ids: list[int]


def _page(session: Session, user: User) -> CareerPage:
    return ensure_page(session, user)


def _owned_section(session: Session, user: User, section_id: int) -> CareerPageSection:
    section = session.get(CareerPageSection, section_id)
    if not section or section.user_id != user.id:
        raise HTTPException(404, "Section not found")
    return section


@router.get("/me/career-page")
def get_career_page(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """The page as its owner sees it, including hidden sections."""
    page = _page(session, current_user)
    return {
        "page": page,
        "sections": sections_for(session, page),
        # So the editor can offer the kinds without hard-coding them.
        "available_kinds": [
            {"kind": kind, "source": source} for kind, source in SECTION_KINDS.items()
        ],
    }


@router.patch("/me/career-page", response_model=CareerPage)
def update_career_page(
    payload: PageUpdate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CareerPage:
    page = _page(session, current_user)
    data = payload.model_dump(exclude_unset=True)

    if "slug" in data and data["slug"] is not None:
        try:
            slug = validate_slug(data["slug"])
        except SlugError as exc:
            raise HTTPException(422, str(exc)) from exc
        taken = session.exec(select(CareerPage).where(CareerPage.slug == slug)).first()
        if taken and taken.id != page.id:
            raise HTTPException(409, "That address is already taken.")
        page.slug = slug
        data.pop("slug")

    if "published" in data and data["published"] is not None:
        publish(page, data.pop("published"))

    for key, value in data.items():
        setattr(page, key, value)

    session.add(page)
    session.commit()
    session.refresh(page)
    return page


@router.post("/me/career-page/sections", response_model=CareerPageSection)
def add_section(
    payload: SectionCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CareerPageSection:
    if payload.kind not in SECTION_KINDS:
        raise HTTPException(422, f"Unknown section kind: {payload.kind}")
    page = _page(session, current_user)
    existing = sections_for(session, page)
    section = CareerPageSection(
        user_id=current_user.id,
        career_page_id=page.id,
        kind=payload.kind,
        title=payload.title,
        body=payload.body,
        layout=payload.layout,
        item_ids=payload.item_ids,
        options=payload.options,
        source=SECTION_KINDS[payload.kind],
        position=(existing[-1].position + 1) if existing else 0,
    )
    session.add(section)
    session.commit()
    session.refresh(section)
    return section


@router.patch("/me/career-page/sections/{section_id}", response_model=CareerPageSection)
def update_section(
    section_id: int,
    payload: SectionUpdate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CareerPageSection:
    section = _owned_section(session, current_user, section_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(section, key, value)
    session.add(section)
    session.commit()
    session.refresh(section)
    return section


@router.delete("/me/career-page/sections/{section_id}", status_code=204)
def delete_section(
    section_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    section = _owned_section(session, current_user, section_id)
    session.delete(section)
    session.commit()


@router.post("/me/career-page/sections/reorder")
def reorder_sections(
    payload: SectionOrder,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, int]:
    """Rewrite the whole order from the list the editor sends.

    Takes every id rather than a move instruction: a drag-and-drop list already
    knows its final order, and rewriting it wholesale cannot leave two sections
    fighting over one position.
    """
    page = _page(session, current_user)
    sections = {section.id: section for section in sections_for(session, page)}
    if set(payload.section_ids) != set(sections):
        raise HTTPException(422, "Send every section on the page exactly once.")
    for position, section_id in enumerate(payload.section_ids):
        sections[section_id].position = position
        session.add(sections[section_id])
    session.commit()
    return {"reordered": len(payload.section_ids)}


@router.get("/career-pages/{slug}")
def public_career_page(slug: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    """The public page. No authentication, so it is deliberately narrow.

    An unpublished page is a 404 rather than a 403: whether a slug is taken by
    an unpublished page is not a stranger's business.
    """
    page = session.exec(select(CareerPage).where(CareerPage.slug == slug.lower())).first()
    if not page or not page.published:
        raise HTTPException(404, "No published page at that address")
    page.view_count += 1
    session.add(page)
    session.commit()
    return render_public_page(session, page)
