from datetime import datetime

from sqlmodel import JSON, Column, Field, UniqueConstraint

from kall.clock import utcnow
from kall.models.core import TimestampMixin


class SearchSource(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    provider: str
    company_name: str
    board_key: str
    enabled: bool = True


class SearchRun(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    professional_profile_id: int = Field(index=True, foreign_key="careerprofile.id")
    started_at: datetime = Field(default_factory=utcnow)
    completed_at: datetime | None = None
    providers_requested: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    # The exact hidden-market search string this run generated from the
    # profile's own criteria at the time -- captured per run because the
    # profile's titles/keywords/exclusions can change between runs, and a
    # past run's query should stay what it actually searched for.
    ats_search_query: str | None = None
    jobs_collected: int = 0
    jobs_created: int = 0
    jobs_skipped: int = 0
    matches_created: int = 0
    errors: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    status: str = "running"


class SuppressedResult(TimestampMixin, table=True):
    """A job posting this user never wants to see again.

    Keyed by normalized URL rather than job id: most of what needs suppressing
    arrives as a raw web result from the Google search workspace and has no Job
    row behind it. Server-side rather than localStorage because the point is
    that it survives -- a different device, and the scheduled discovery run
    that builds the daily brief without a browser involved.
    """

    __table_args__ = (UniqueConstraint("user_id", "url", name="uq_suppressedresult_user_url"),)

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    url: str = Field(index=True)
    # dead_link  -- posting is gone or the link is broken; also excluded from
    #               discovery, so it never returns to the opportunity inbox.
    # applied_*  -- already applied; hidden from search results only, because
    #               the application itself is the record that matters.
    reason: str = "dead_link"
    title: str | None = None
    suppressed_at: datetime = Field(default_factory=utcnow)
