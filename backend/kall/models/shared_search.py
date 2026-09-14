"""Help a friend find a job: a public, refreshable digest of matching
postings, generated from either the owner's own CareerProfile or a
lightweight set of criteria -- filled in by the owner on a friend's behalf,
or by the friend themselves via the same public link.

Deliberately one public slug per share rather than a separate signed/
expiring invite token layered on top (the shape TestimonialRequest uses):
a wrong or fake answer here costs nothing the way a false identity
attestation would, so the extra token machinery isn't worth it. `status`
alone tells the public endpoint what to render at that slug.
"""

from datetime import datetime
from typing import Any

from sqlmodel import JSON, Column, Field

from kall.models.core import TimestampMixin


class SharedSearch(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    owner_user_id: int = Field(index=True, foreign_key="user.id")

    #: The public URL is /friend/{slug}. Unique across all shares.
    slug: str = Field(index=True, unique=True)

    #: For the owner's own list only -- never shown on the public page.
    friend_label: str | None = None

    #: Set when sharing the owner's own profile as-is (path 1): criteria are
    #: read live from this CareerProfile on every digest generation, so
    #: editing the profile later updates the friend's page too. Mutually
    #: exclusive with `criteria` below.
    source_profile_id: int | None = Field(default=None, foreign_key="careerprofile.id")

    #: Set for paths 2 (owner fills it in for the friend) and 3 (the friend
    #: fills it in themselves via this same public link) instead of
    #: source_profile_id: {target_titles, countries, states_regions, cities,
    #: work_types, industries}. Deliberately smaller than the full
    #: CareerProfile shape -- no salary/keywords/equity -- to keep the
    #: intake form short.
    criteria: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))

    #: "awaiting_input" (path 3, no criteria yet) -> "active" (criteria
    #: present, digest works) -> "revoked" (owner took it down; the slug
    #: 404s from then on, same as a missing one -- never distinguishable).
    status: str = "active"

    #: Cached results from the most recent digest generation, so a view
    #: doesn't always pay for a fresh search -- see
    #: services/shared_search.py's refresh_if_stale.
    last_digest: list[dict[str, Any]] | None = Field(default=None, sa_column=Column(JSON))
    last_refreshed_at: datetime | None = None

    view_count: int = 0
