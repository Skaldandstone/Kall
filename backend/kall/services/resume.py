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


def reflow_extracted_text(text: str) -> str:
    """Join word-per-line extraction back into paragraphs.

    Blank lines still mark paragraph breaks; a lone bullet glyph on its own
    line is kept as a separator inside the paragraph. Text that already has
    real lines is returned unchanged (apart from trailing whitespace), so
    this is safe to apply to every upload.
    """
    normalized = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")
    if not _looks_word_per_line(lines):
        return "\n".join(line.rstrip() for line in lines).strip()
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
