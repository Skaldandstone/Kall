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
#: lost every real line break, a token that reads as one of these, right
#: after the end of a sentence, is the only paragraph boundary left.
#: Matched case-insensitively and with trailing punctuation stripped: a real
#: resume token here is "Experience:" or "SKILLS", not the bare "Experience"
#: this used to require verbatim -- neither of those matched at all, so a
#: resume using either style collapsed into one page-length paragraph with
#: no recognizable section boundaries, and parse_resume() (which looks for
#: a heading as its own line) never saw "experience" as anything but buried
#: mid-sentence text.
_SECTION_HEADINGS = {
    "summary", "profile", "experience", "employment", "skills", "education", "certifications",
    "awards", "publications", "projects", "leadership", "languages", "patents", "interests",
}


def _paragraphs_from_tokens(tokens: list[str]) -> list[str]:
    paragraphs: list[list[str]] = [[]]
    heading_starts: list[bool] = [False]
    for index, token in enumerate(tokens):
        previous = tokens[index - 1] if index else ""
        normalized = token.strip(".:;!?").casefold()
        is_heading_word = normalized in _SECTION_HEADINGS
        # A bullet list commonly runs straight into the next heading with no
        # closing punctuation ("...test automation engineers Skills:
        # Automation Frameworks..."), so requiring the *previous* token to
        # end a sentence misses exactly the headings that follow a bullet.
        # The heading word's own trailing colon is the more reliable signal
        # here -- prose uses "years of experience" without one, a heading
        # uses "Experience:" -- so a colon alone is enough to open a
        # section; without one, still require the previous token to end a
        # sentence, or "experience" used as an ordinary word would wrongly
        # split the paragraph it's already part of.
        opens_section = is_heading_word and (token.endswith(":") or index == 0 or previous.endswith((".", ":", "!", "?")))
        if opens_section and paragraphs[-1]:
            paragraphs.append([])
            heading_starts.append(True)
        paragraphs[-1].append(token)
    result = []
    for starts_with_heading, part in zip(heading_starts, paragraphs, strict=True):
        if not part:
            continue
        if starts_with_heading:
            # The heading goes on its own line so parse_resume()'s per-line
            # heading check -- which requires the whole line to be the
            # heading, not just start with it -- can actually recognize it,
            # rather than seeing one giant line beginning with the word.
            body = " ".join(part[1:])
            result.append(f"{part[0]}\n{body}" if body else part[0])
        else:
            result.append(" ".join(part))
    return result


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
