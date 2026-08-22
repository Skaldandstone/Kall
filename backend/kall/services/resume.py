import io

from docx import Document
from pypdf import PdfReader


def extract_resume_text(data: bytes, mime_type: str) -> str:
    if mime_type == "application/pdf":
        return "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(data)).pages)
    if mime_type.endswith("wordprocessingml.document"):
        return "\n".join(p.text for p in Document(io.BytesIO(data)).paragraphs)
    return data.decode("utf-8", errors="ignore")
