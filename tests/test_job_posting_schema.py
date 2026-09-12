import httpx
import pytest
from kall.services.job_posting_schema import extract_job_posting, fetch_job_posting_description


def _page(jsonld: str) -> str:
    return f"""<html><head>
<script type="application/ld+json">{jsonld}</script>
</head><body>Careers page</body></html>"""


def test_extracts_a_single_job_posting_object() -> None:
    html = _page('{"@context":"https://schema.org","@type":"JobPosting","title":"Line Cook","description":"<p>Prep and cook food to order.</p>"}')
    posting = extract_job_posting(html)
    assert posting is not None
    assert posting["title"] == "Line Cook"


def test_finds_job_posting_inside_a_list() -> None:
    html = _page('[{"@type":"WebPage"},{"@type":"JobPosting","title":"Nurse","description":"Patient care."}]')
    posting = extract_job_posting(html)
    assert posting is not None and posting["title"] == "Nurse"


def test_finds_job_posting_inside_a_graph() -> None:
    html = _page('{"@context":"https://schema.org","@graph":[{"@type":"Organization"},{"@type":"JobPosting","title":"Pilot","description":"Fly the plane."}]}')
    posting = extract_job_posting(html)
    assert posting is not None and posting["title"] == "Pilot"


def test_no_structured_data_returns_none() -> None:
    assert extract_job_posting("<html><body>Nothing here</body></html>") is None


def test_malformed_json_is_skipped_not_raised() -> None:
    assert extract_job_posting(_page("{not valid json")) is None


def test_a_non_jobposting_type_is_ignored() -> None:
    html = _page('{"@type":"Organization","name":"Acme"}')
    assert extract_job_posting(html) is None


@pytest.mark.parametrize("status", [404, 500])
def test_fetch_returns_none_on_a_bad_status(status: int) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert fetch_job_posting_description("https://example.com/job/1", client=client) is None


def test_fetch_returns_none_when_the_page_has_no_schema() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html><body>Just a page</body></html>")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert fetch_job_posting_description("https://example.com/job/1", client=client) is None


def test_fetch_returns_plain_text_html_stripped_description() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=_page(
            '{"@type":"JobPosting","title":"Retail Associate",'
            '"description":"<p>Greet customers.</p><p>Operate the register &amp; restock shelves.</p>"}'
        ))

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        description = fetch_job_posting_description("https://example.com/job/1", client=client)

    assert description == "Greet customers.\n\nOperate the register & restock shelves."


def test_fetch_returns_none_when_description_is_missing_or_not_a_string() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=_page('{"@type":"JobPosting","title":"Role","description":123}'))

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert fetch_job_posting_description("https://example.com/job/1", client=client) is None


def test_fetch_survives_a_network_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out", request=request)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert fetch_job_posting_description("https://example.com/job/1", client=client) is None
