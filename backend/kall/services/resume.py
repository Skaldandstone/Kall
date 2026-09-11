import io
import re

from docx import Document
from pypdf import PdfReader

# pypdf emits some PDFs (notably designed, multi-column resumes) as one word
# per line -- "Strategic\nDirector\nof\nSoftware\n..." -- because every
# positioned text run becomes its own line. Stored and shown verbatim that
# reads as a broken document and defeats every paragraph-based heuristic
# downstream (summary detection, proofreading, section splitting).
_SHORT_LINE_WORDS = 2
_WORD_PER_LINE_SHARE = 0.6
_MIN_LINES_TO_JUDGE = 12
_BULLET = re.compile(r"^[•●▪‣\-\*·]$")


def _looks_word_per_line(lines: list[str]) -> bool:
    filled = [line for line in lines if line.strip()]
    if len(filled) < _MIN_LINES_TO_JUDGE:
        return False
    short = sum(1 for line in filled if len(line.split()) <= _SHORT_LINE_WORDS)
    return short / len(filled) >= _WORD_PER_LINE_SHARE


#: Headings a resume uses to open a section. When word-per-line output has
#: lost every real line break, a title-case token equal to one of these,
#: right after the end of a sentence, is the only paragraph boundary left.
_SECTION_HEADINGS = {
    "Summary", "Profile", "Experience", "Employment", "Skills", "Education", "Certifications",
    "Awards", "Publications", "Projects", "Leadership", "Languages", "Patents", "Interests",
}


def _paragraphs_from_tokens(tokens: list[str]) -> list[str]:
    paragraphs: list[list[str]] = [[]]
    for index, token in enumerate(tokens):
        previous = tokens[index - 1] if index else ""
        opens_section = token in _SECTION_HEADINGS and (index == 0 or previous.endswith((".", ":", "!", "?")))
        if opens_section and paragraphs[-1]:
            paragraphs.append([])
        paragraphs[-1].append(token)
    return [" ".join(part) for part in paragraphs if part]


def reflow_extracted_text(text: str) -> str:
    """Join word-per-line extraction back into paragraphs.

    Two shapes come out of pypdf for designed resumes: one word per line,
    with blank lines marking paragraph breaks; and one word per line with a
    blank line between *every* word, where blank lines mean nothing. In the
    second shape the only paragraph boundaries left are section headings
    after a sentence end. Text that already has real lines is returned
    unchanged (apart from trailing whitespace), so this is safe to apply to
    every upload.
    """
    normalized = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")
    if not _looks_word_per_line(lines):
        return "\n".join(line.rstrip() for line in lines).strip()
    filled = sum(1 for line in lines if line.strip())
    blank = sum(1 for line in lines if not line.strip())
    if filled and blank >= 0.5 * filled:
        tokens = [line.strip() for line in lines if line.strip()]
        return "\n\n".join(_paragraphs_from_tokens(tokens)).strip()
    paragraphs: list[str] = []
    current: list[str] = []
    for raw in lines:
        token = raw.strip()
        if not token:
            if current:
                paragraphs.append(" ".join(current))
                current = []
            continue
        current.append(token)
    if current:
        paragraphs.append(" ".join(current))
    return "\n\n".join(paragraphs).strip()


def extract_resume_text(data: bytes, mime_type: str) -> str:
    if mime_type == "application/pdf":
        raw = "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(data)).pages)
    elif mime_type.endswith("wordprocessingml.document"):
        raw = "\n".join(p.text for p in Document(io.BytesIO(data)).paragraphs)
    else:
        raw = data.decode("utf-8", errors="ignore")
    return reflow_extracted_text(raw)
