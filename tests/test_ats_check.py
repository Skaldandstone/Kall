import io
import sys

sys.path.insert(0, "tests")
from kall.services.ats_check import STANDARD_HEADINGS, ats_comparison, run_ats_checks  # noqa: E402
from kall.services.resume_assembly import _SECTION_TITLES, assemble_resume  # noqa: E402
from kall.services.resume_render import TREATMENTS, render_pdf  # noqa: E402
from pypdf import PdfReader  # noqa: E402
from test_resume_layout import TAILORED, _session, _user_with_record  # noqa: E402


def test_every_rendered_section_title_is_a_heading_the_ats_check_itself_recognizes() -> None:
    """resume_assembly._SECTION_TITLES (what actually gets rendered onto a
    resume) and ats_check.STANDARD_HEADINGS (what the "headings" check
    accepts) are two lists maintained by hand in two different files --
    nothing stops them drifting apart, at which point every resume Kall
    generates would fail its own ATS check on a heading Kall itself chose
    to render. Every title in the first list must casefold into the
    second."""
    for title in _SECTION_TITLES.values():
        assert title.casefold() in STANDARD_HEADINGS, f"{title!r} is rendered but not recognized as a standard heading"


def test_every_template_passes_the_structural_ats_checks() -> None:
    with _session() as session:
        user = _user_with_record(session)
        layout = assemble_resume(session, user.id, TAILORED)
    for key in TREATMENTS:
        pdf = render_pdf(layout, key)
        checks = {check.key: check for check in run_ats_checks(layout, pdf)}
        for structural in ("name", "headings", "core_sections", "reading_order", "dates", "fonts", "no_images", "length", "clean_text"):
            assert checks[structural].passed, f"{key}: {structural}: {checks[structural].detail}"
        # The fixture has no phone number and little text, which is exactly
        # what these two checks are meant to surface.
        assert not checks["contact"].passed
        assert "phone missing" in checks["contact"].detail
        assert checks["contact"].fix_href == "/settings/identity#identity-phone"
        assert not checks["substance"].passed
        assert checks["core_sections"].fix_href is None
        extracted = "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(pdf)).pages)
        # Every look must preserve role boundaries and individual evidence;
        # visual treatment may change, content structure may not flatten.
        assert extracted.index("Director of Quality Engineering") < extracted.index("QA Manager")
        assert "Led a 30-person QA org." in extracted
        assert "Built CI gates for 40 services." in extracted
        assert "Ran regression for the payments platform." in extracted


def test_missing_core_sections_points_to_the_professional_record() -> None:
    with _session() as session:
        user = _user_with_record(session)
        layout = assemble_resume(session, user.id, TAILORED)
    layout["sections"] = [section for section in layout["sections"] if section["key"] != "experience"]
    checks = {check.key: check for check in run_ats_checks(layout, render_pdf(layout, "standard"))}
    assert not checks["core_sections"].passed
    assert checks["core_sections"].fix_href == "/profiles"


def test_comparison_preserves_final_shape_and_explains_remaining_work() -> None:
    with _session() as session:
        user = _user_with_record(session)
        after_layout = assemble_resume(session, user.id, TAILORED)
        before_layout = assemble_resume(session, user.id, [])
    result = ats_comparison(
        before_layout,
        render_pdf(before_layout, "standard"),
        after_layout,
        render_pdf(after_layout, "standard"),
    )
    assert result["passed"] == result["after"]["passed"]
    assert result["checks"] == result["after"]["checks"]
    contact = next(item for item in result["remaining"] if item["key"] == "contact")
    assert contact["resolution"]
    assert contact["fix_href"] == "/settings/identity#identity-phone"


def test_a_scrambled_document_fails_reading_order() -> None:
    with _session() as session:
        user = _user_with_record(session)
        layout = assemble_resume(session, user.id, TAILORED)
    pdf = render_pdf(layout, "standard")
    # Pretend the layout lists the jobs in the opposite order to the PDF.
    experience = next(section for section in layout["sections"] if section["key"] == "experience")
    experience["entries"].reverse()
    checks = {check.key: check for check in run_ats_checks(layout, pdf)}
    assert not checks["reading_order"].passed
