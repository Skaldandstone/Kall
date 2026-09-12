import httpx
import pytest
from kall.providers.workday import WorkdayProvider, _parse_board_key


@pytest.mark.parametrize(
    ("board_key", "expected"),
    [
        ("acme.wd5.myworkdayjobs.com/External", ("acme.wd5.myworkdayjobs.com", "acme", "External")),
        ("https://acme.wd5.myworkdayjobs.com/External", ("acme.wd5.myworkdayjobs.com", "acme", "External")),
        ("acme.wd5.myworkdayjobs.com/External/", ("acme.wd5.myworkdayjobs.com", "acme", "External")),
        ("acme.wd5.myworkdayjobs.com", ("acme.wd5.myworkdayjobs.com", "acme", "External")),
    ],
)
def test_board_key_parses_host_tenant_and_site(board_key: str, expected: tuple[str, str, str]) -> None:
    assert _parse_board_key(board_key) == expected


@pytest.mark.asyncio
async def test_workday_fetches_the_list_then_each_postings_own_description():
    """Unlike Greenhouse's single call, Workday's list endpoint has no
    description -- collect() must make the follow-up per-posting call
    rather than silently shipping a job with no real content."""
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        if request.url.path.endswith("/jobs"):
            return httpx.Response(200, json={"jobPostings": [{
                "title": "Retail Store Manager",
                "externalPath": "/job/Store-1234/Retail-Store-Manager_R-9001",
                "locationsText": "Columbus, OH",
                "bulletFields": ["R-9001"],
            }]})
        return httpx.Response(200, json={"jobPostingInfo": {"jobDescription": "Manage daily store operations."}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        jobs = await WorkdayProvider(client).collect("Acme Retail", "acme.wd5.myworkdayjobs.com/External")

    assert len(jobs) == 1
    job = jobs[0]
    assert job.company == "Acme Retail"
    assert job.title == "Retail Store Manager"
    assert job.description == "Manage daily store operations."
    assert job.url == "https://acme.wd5.myworkdayjobs.com/External/job/Store-1234/Retail-Store-Manager_R-9001"
    assert job.location == "Columbus, OH"
    assert job.external_id == "R-9001"
    # One list call plus one description call for the single posting returned.
    assert len(calls) == 2
    assert calls[0].endswith("/wday/cxs/acme/External/jobs")
    assert calls[1].endswith("/wday/cxs/acme/External/job/Store-1234/Retail-Store-Manager_R-9001")


@pytest.mark.asyncio
async def test_a_failed_description_fetch_does_not_drop_the_posting():
    """One malformed or unreachable posting detail must not blank the
    company's other real, open postings."""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/jobs"):
            return httpx.Response(200, json={"jobPostings": [{
                "title": "Line Cook",
                "externalPath": "/job/Kitchen/Line-Cook_R-1",
                "locationsText": "Remote",
            }]})
        return httpx.Response(500)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        jobs = await WorkdayProvider(client).collect("Acme Diner", "acme.wd1.myworkdayjobs.com/External")

    assert len(jobs) == 1
    assert jobs[0].title == "Line Cook"
    assert jobs[0].description == "Line Cook"  # falls back to the title, not an empty string


@pytest.mark.asyncio
async def test_a_posting_with_no_external_path_is_still_returned_without_a_description_fetch():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/jobs"), "no detail call should happen with no path to fetch"
        return httpx.Response(200, json={"jobPostings": [{"title": "Unlisted Role", "locationsText": "Remote"}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        jobs = await WorkdayProvider(client).collect("Acme", "acme.wd1.myworkdayjobs.com/External")

    assert jobs[0].description == "Unlisted Role"
