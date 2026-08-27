"""A shareable career page: the thing a person sends instead of a PDF.

Two ideas shape the model.

**Modular.** A page is an ordered list of sections, not a fixed template. Each
section is a row, so a page can have three or thirty, in any order, of any
kind, and new kinds cost a string rather than a migration.

**Manually organizable.** The user decides what appears and where. `position`
orders sections, `visible` hides one without deleting it, and `item_ids`
curates exactly which records a data-backed section shows. Nothing is arranged
automatically, because the whole point of this page over a generated resume is
that the person chose the argument it makes.
"""

from datetime import datetime
from typing import Any

from sqlmodel import JSON, Column, Field

from kall.models.core import TimestampMixin


class CareerPage(TimestampMixin, table=True):
    """One per user. Unpublished until they say otherwise."""

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id", unique=True)

    #: The public URL is /p/{slug}. Unique across all users, so it is claimed
    #: rather than assigned, and validated before it ever reaches the database.
    slug: str = Field(index=True, unique=True)

    #: Nothing is reachable publicly until this is true. Defaults to false so a
    #: page cannot become visible as a side effect of being created.
    published: bool = False

    display_name: str | None = None
    headline: str | None = None
    #: One or two sentences under the headline.
    summary: str | None = None
    location: str | None = None

    #: Named theme, resolved by the renderer. Not free-form CSS.
    theme: str = "parchment"

    #: Links the user wants on the page, as [{label, url}]. Kept here rather
    #: than read from the identity profile so the page can show a different
    #: subset from the one autofill uses.
    links: list[dict[str, str]] = Field(default_factory=list, sa_column=Column(JSON))

    published_at: datetime | None = None
    view_count: int = 0


class CareerPageSection(TimestampMixin, table=True):
    """One block on the page.

    A section is either *authored* -- prose the user wrote -- or *sourced*, in
    which case it renders records from their Kall profile. A sourced section
    may be both: a heading and intro paragraph above the records.
    """

    id: int | None = Field(default=None, primary_key=True)
    #: Denormalized from the page so ownership can be checked without a join
    #: on every request. The API asserts the two agree.
    user_id: int = Field(index=True, foreign_key="user.id")
    career_page_id: int = Field(index=True, foreign_key="careerpage.id")

    #: What this section is for -- see SECTION_KINDS in services/career_page.py.
    kind: str

    title: str
    body: str | None = None

    #: Ascending. Gaps are fine; the reorder endpoint rewrites the whole set.
    position: int = 0

    #: Hidden sections stay editable and keep their content. Removing a section
    #: from a page should not mean losing what it said.
    visible: bool = True

    #: Which profile records to draw from, or None for an authored section.
    source: str | None = None

    #: The records to show, in the order given. An empty list means "all of
    #: them", which is the sensible default for a section the user just added.
    item_ids: list[int] = Field(default_factory=list, sa_column=Column(JSON))

    #: Renderer hint: list, grid, or timeline.
    layout: str = "list"

    #: Room for kind-specific settings without a migration per idea.
    options: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
