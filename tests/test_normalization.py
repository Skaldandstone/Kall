from kall.models.enums import WorkType
from kall.providers.jobs import DiscoveredJob
from kall.services.normalization import clean_text, fingerprint, normalize_discovered


def test_fingerprint_ignores_tracking_query():
    a=DiscoveredJob("x","1","Acme","Director, Engineering","","https://a.test/job?utm=x")
    b=DiscoveredJob("y","2","Acme","Director, Engineering","","https://a.test/job?utm=y")
    assert fingerprint(a)==fingerprint(b)


def test_remote_and_salary_are_inferred():
    job=DiscoveredJob("x","1","Acme","Director","Remote US role paying $190,000 to $230,000","https://a.test/job","United States Remote")
    data=normalize_discovered(job)
    assert data["work_type"]==WorkType.REMOTE
    assert data["salary_min"]==190000
    assert data["salary_max"]==230000


def test_clean_text_turns_block_tags_into_line_breaks_not_spaces():
    """Regression test: collapsing every tag straight to a space flattened a
    whole job description's paragraphs and bullet points into one giant line
    with no newlines at all -- intelligence.analyze_job() classifies a
    posting's required/preferred/responsibility text per line, so a
    description with zero newlines becomes either one all-or-nothing
    "requirement" (if the word appears anywhere in the blob) or none, and any
    per-line keyword extraction pulls from wherever that one giant line
    happens to start rather than the actual requirement bullets."""
    html = "<p>Intro paragraph.</p><ul><li>Required: food safety</li><li>Preferred: guest service</li></ul>"
    cleaned = clean_text(html)
    lines = [line for line in cleaned.split("\n") if line.strip()]
    assert lines == ["Intro paragraph.", "Required: food safety", "Preferred: guest service"]


def test_clean_text_still_collapses_runs_of_horizontal_whitespace():
    assert clean_text("Acme   Corp\t\tDirector") == "Acme Corp Director"
