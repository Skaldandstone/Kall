"""Check a generated resume the way an applicant tracking system reads it.

Every check is made against the *rendered PDF* -- the bytes an employer's
parser receives -- not against the layout the renderer was given. The text
is extracted back out with pypdf and compared with what should be there, so
"ATS-readable" is something the product verified rather than promised.
"""

import io
import re
from dataclasses import asdict, dataclass

from pypdf import PdfReader

STANDARD_HEADINGS = {
    "summary", "profile", "experience", "work experience", "professional experience", "employment",
    "skills", "education", "certifications", "awards", "publications", "projects", "languages",
    "patents", "selected achievements", "achievements",
}
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE = re.compile(r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b")
_DATE = re.compile(r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}\b|\b(?:19|20)\d{2}\b")
_STANDARD_FONTS = ("Helvetica", "Times", "Arial", "Calibri", "Georgia", "Courier", "BitstreamVera", "Vera", "DejaVu")


@dataclass
class AtsCheck:
    key: str
    label: str
    passed: bool
    detail: str


def _extract(pdf: bytes) -> tuple[list[str], int, list[str], int]:
    reader = PdfReader(io.BytesIO(pdf))
    pages = [page.extract_text() or "" for page in reader.pages]
    fonts: set[str] = set()
    images = 0
    for page in reader.pages:
        resources = page.get("/Resources") or {}
        for _, font in (resources.get("/Font") or {}).items():
            try:
                # Embedded subsets are tagged "ABCDEF+Name"; the tag is not part of the face.
                fonts.add(str(font.get_object().get("/BaseFont", "")).lstrip("/").split("+")[-1])
            except Exception:  # noqa: BLE001 - malformed font entries are a failed check, not a crash
                fonts.add("unknown")
        images += len(resources.get("/XObject") or {})
    return pages, len(pages), sorted(fonts), images


def run_ats_checks(layout: dict, pdf: bytes) -> list[AtsCheck]:
    pages, page_count, fonts, images = _extract(pdf)
    text = "\n".join(pages)
    flat = re.sub(r"\s+", " ", text)
    checks: list[AtsCheck] = []

    name = str(layout.get("name") or "")
    checks.append(AtsCheck("name", "Name is the first thing on the page", bool(name) and text.strip().startswith(name),
                           f"Found '{name}' at the top." if name and text.strip().startswith(name) else "The name is not the first line of extracted text."))
    email = _EMAIL.search(flat)
    phone = _PHONE.search(flat)
    checks.append(AtsCheck("contact", "Email and phone can be read from the header", bool(email and phone),
                           "Email and phone both extract." if email and phone else ("Email found, phone missing." if email else "No email address found in the header.")))

    headings_present = [s for s in layout.get("sections", []) if str(s.get("title", "")).casefold() in STANDARD_HEADINGS]
    nonstandard = [str(s.get("title")) for s in layout.get("sections", []) if str(s.get("title", "")).casefold() not in STANDARD_HEADINGS]
    checks.append(AtsCheck("headings", "Section headings use standard names", not nonstandard,
                           "All headings are ones parsers recognise." if not nonstandard else f"Non-standard heading(s): {', '.join(nonstandard)}."))
    checks.append(AtsCheck("core_sections", "Experience and skills sections are present",
                           any(str(s.get("key")) == "experience" for s in layout.get("sections", [])) and any(str(s.get("key")) == "skills" for s in layout.get("sections", [])),
                           "Both present." if headings_present else "Add work history and skills to the professional record."))

    # Reading order: within each section, entries must extract in the order
    # they are listed -- a multi-column or table-mangled PDF scrambles this.
    # Sections themselves may be reordered by the chosen look.
    in_order = True
    any_titles = False
    for section in layout.get("sections", []):
        titles = [str(e.get("title")) for e in section.get("entries", []) if e.get("title")]
        if not titles:
            continue
        any_titles = True
        positions = [flat.find(title) for title in titles]
        if any(p < 0 for p in positions) or positions != sorted(positions):
            in_order = False
    checks.append(AtsCheck("reading_order", "Jobs extract in the order they appear", in_order or not any_titles,
                           "Every job title extracts in order." if in_order or not any_titles else "Some job titles are missing or out of order in the extracted text."))

    dates = [str(e.get("dates")) for s in layout.get("sections", []) for e in s.get("entries", []) if e.get("dates")]
    dates_ok = all(_DATE.search(d) and (d in flat) for d in dates)
    checks.append(AtsCheck("dates", "Dates are consistent and extractable", dates_ok,
                           "Every date range extracts as written." if dates_ok else "A date range did not extract cleanly."))

    bad_fonts = [f for f in fonts if not any(f.startswith(std) or std in f for std in _STANDARD_FONTS)]
    checks.append(AtsCheck("fonts", "Standard fonts only", not bad_fonts, f"Fonts: {', '.join(fonts) or 'none'}." if not bad_fonts else f"Unusual font(s): {', '.join(bad_fonts)}."))
    checks.append(AtsCheck("no_images", "No images or graphics carry content", images == 0, "Text only." if images == 0 else f"{images} embedded object(s) found."))
    checks.append(AtsCheck("length", "One or two pages", 1 <= page_count <= 2, f"{page_count} page(s)."))
    words = len(flat.split())
    checks.append(AtsCheck("substance", "Enough content to score against a posting", words >= 120, f"{words} words."))
    unreadable = sum(1 for ch in text if ch in "\x7f�" or (ord(ch) < 32 and ch not in "\n\t"))
    checks.append(AtsCheck("clean_text", "Every character extracts as readable text", unreadable == 0,
                           "No unreadable characters." if unreadable == 0 else f"{unreadable} character(s) came out as garbage -- usually a bullet or symbol the font cannot map."))
    return checks


def ats_report(layout: dict, pdf: bytes) -> dict:
    checks = run_ats_checks(layout, pdf)
    passed = sum(1 for check in checks if check.passed)
    return {"passed": passed, "total": len(checks), "checks": [asdict(check) for check in checks]}
