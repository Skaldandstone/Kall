"""Render an assembled resume layout as a formatted PDF or Word file.

Each template key is a visual treatment -- typeface, accent, density, and
section order -- applied to the same layout. Rendering is deterministic:
the same layout and template always produce byte-identical files, which the
document checksums depend on.
"""

import io
from datetime import datetime
from xml.sax.saxutils import escape

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    HRFlowable,
    ListFlowable,
    ListItem,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

Layout = dict[str, object]


class Treatment:
    """The visual decisions one template makes."""

    def __init__(
        self,
        *,
        serif: bool,
        accent: str,
        centered: bool,
        body_size: float,
        name_size: float,
        section_order: tuple[str, ...],
        rule: bool = True,
        caps_headings: bool = True,
    ) -> None:
        self.serif = serif
        self.accent = accent
        self.centered = centered
        self.body_size = body_size
        self.name_size = name_size
        self.section_order = section_order
        self.rule = rule
        self.caps_headings = caps_headings

    @property
    def pdf_font(self) -> str:
        return "Times-Roman" if self.serif else "Helvetica"

    @property
    def pdf_bold(self) -> str:
        return "Times-Bold" if self.serif else "Helvetica-Bold"

    @property
    def pdf_italic(self) -> str:
        return "Times-Italic" if self.serif else "Helvetica-Oblique"

    @property
    def docx_font(self) -> str:
        return "Georgia" if self.serif else "Calibri"


_NAVY = "#1F2A44"
_BRASS = "#8C6D2F"
_TEAL = "#1B5E5A"
_INK = "#222222"

TREATMENTS: dict[str, Treatment] = {
    "standard": Treatment(serif=True, accent=_INK, centered=True, body_size=10.5, name_size=20, section_order=("summary", "experience", "achievements", "skills", "education", "certifications")),
    "executive": Treatment(serif=False, accent=_NAVY, centered=False, body_size=10.5, name_size=22, section_order=("summary", "achievements", "experience", "skills", "education", "certifications")),
    "technical-leadership": Treatment(serif=False, accent=_NAVY, centered=False, body_size=10.5, name_size=20, section_order=("summary", "achievements", "skills", "experience", "education", "certifications")),
    "creative": Treatment(serif=False, accent=_TEAL, centered=False, body_size=10.5, name_size=24, section_order=("summary", "projects", "achievements", "experience", "skills", "education"), caps_headings=False),
    "commercial": Treatment(serif=False, accent=_BRASS, centered=False, body_size=10.5, name_size=20, section_order=("summary", "achievements", "experience", "skills", "education", "certifications")),
    "service": Treatment(serif=False, accent=_INK, centered=True, body_size=10.5, name_size=19, section_order=("summary", "skills", "certifications", "experience", "education")),
    "early": Treatment(serif=True, accent=_INK, centered=True, body_size=10.5, name_size=20, section_order=("summary", "skills", "projects", "education", "experience", "certifications")),
    "compact": Treatment(serif=False, accent=_INK, centered=False, body_size=9.5, name_size=17, section_order=("summary", "achievements", "experience", "skills", "education", "certifications")),
}


def treatment_for(template_key: str) -> Treatment:
    return TREATMENTS.get(template_key, TREATMENTS["standard"])


def ordered_sections(layout: Layout, treatment: Treatment) -> list[dict[str, object]]:
    sections = list(layout.get("sections", []))  # type: ignore[arg-type]

    def rank(item: tuple[int, dict[str, object]]) -> tuple[int, int]:
        index, section = item
        key = str(section.get("key", ""))
        try:
            return treatment.section_order.index(key), index
        except ValueError:
            return len(treatment.section_order), index

    return [section for _, section in sorted(enumerate(sections), key=rank)]


def _heading_text(title: str, treatment: Treatment) -> str:
    return title.upper() if treatment.caps_headings else title


# --------------------------------------------------------------------------- PDF


def render_pdf(layout: Layout, template_key: str) -> bytes:
    t = treatment_for(template_key)
    base = ParagraphStyle("body", fontName=t.pdf_font, fontSize=t.body_size, leading=t.body_size * 1.32, textColor=colors.HexColor(_INK))
    name_style = ParagraphStyle("name", parent=base, fontName=t.pdf_bold, fontSize=t.name_size, leading=t.name_size * 1.15, textColor=colors.HexColor(t.accent), alignment=TA_CENTER if t.centered else TA_LEFT, spaceAfter=3)
    contact_style = ParagraphStyle("contact", parent=base, fontSize=t.body_size - 1, leading=(t.body_size - 1) * 1.3, textColor=colors.HexColor("#555555"), alignment=TA_CENTER if t.centered else TA_LEFT)
    heading_style = ParagraphStyle("heading", parent=base, fontName=t.pdf_bold, fontSize=t.body_size + 1.5, leading=(t.body_size + 1.5) * 1.25, textColor=colors.HexColor(t.accent), spaceBefore=9, spaceAfter=2, keepWithNext=1)
    entry_title = ParagraphStyle("entryTitle", parent=base, fontName=t.pdf_bold, keepWithNext=1)
    entry_meta = ParagraphStyle("entryMeta", parent=base, fontName=t.pdf_italic, textColor=colors.HexColor("#444444"))
    entry_dates = ParagraphStyle("entryDates", parent=base, alignment=2, textColor=colors.HexColor("#444444"))
    bullet_style = ParagraphStyle("bullet", parent=base, leftIndent=0)

    story: list[object] = []
    if layout.get("name"):
        story.append(Paragraph(escape(str(layout["name"])), name_style))
    if layout.get("contact"):
        story.append(Paragraph(escape("  •  ".join(str(part) for part in layout["contact"])), contact_style))
    story.append(Spacer(1, 6))

    # The frame pads 6pt on each side; size rules and tables to the text
    # column so they align with the paragraphs rather than overhanging it.
    width = LETTER[0] - 1.5 * inch - 12

    def bullets(items: list[object]) -> ListFlowable:
        return ListFlowable(
            [ListItem(Paragraph(escape(str(item)), bullet_style), leftIndent=12) for item in items],
            bulletType="bullet", bulletFontSize=t.body_size - 2, leftIndent=12, bulletOffsetY=-1,
        )

    for section in ordered_sections(layout, t):
        story.append(Paragraph(escape(_heading_text(str(section["title"]), t)), heading_style))
        if t.rule:
            story.append(HRFlowable(width=width, thickness=0.7, color=colors.HexColor(t.accent), spaceBefore=0, spaceAfter=4))
        for paragraph in section.get("paragraphs", []):
            story.append(Paragraph(escape(str(paragraph)), base))
            story.append(Spacer(1, 3))
        if section.get("bullets"):
            story.append(bullets(section["bullets"]))
        for group in section.get("groups", []):
            story.append(Paragraph(f"<b>{escape(str(group['label']))}:</b> {escape(', '.join(str(item) for item in group['items']))}", base))
            story.append(Spacer(1, 2))
        for entry in section.get("entries", []):
            head = escape(str(entry.get("title") or ""))
            org = " — ".join(value for value in (entry.get("organization"), entry.get("location")) if value)
            table = Table([[Paragraph(head, entry_title), Paragraph(escape(str(entry.get("dates") or "")), entry_dates)]], colWidths=[width * 0.74, width * 0.26], hAlign="LEFT")
            table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
            story.append(table)
            if org:
                story.append(Paragraph(escape(org), entry_meta))
            if entry.get("bullets"):
                story.append(bullets(entry["bullets"]))
            story.append(Spacer(1, 4))

    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer, pagesize=LETTER, title=str(layout.get("name") or "Resume"), author=str(layout.get("name") or ""),
        leftMargin=0.75 * inch, rightMargin=0.75 * inch, topMargin=0.7 * inch, bottomMargin=0.7 * inch, invariant=1,
    )
    document.build(story)
    return buffer.getvalue()


# -------------------------------------------------------------------------- DOCX

_FIXED_TIMESTAMP = datetime(2020, 1, 1)


def _bottom_border(paragraph, color_hex: str) -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    borders = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "6")
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), color_hex.lstrip("#"))
    borders.append(bottom)
    p_pr.append(borders)


def _rgb(color_hex: str) -> RGBColor:
    value = color_hex.lstrip("#")
    return RGBColor(int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16))


def render_docx(layout: Layout, template_key: str) -> bytes:
    t = treatment_for(template_key)
    document = Document()
    for section in document.sections:
        section.left_margin = section.right_margin = int(0.75 * 914400)
        section.top_margin = section.bottom_margin = int(0.7 * 914400)
    normal = document.styles["Normal"]
    normal.font.name = t.docx_font
    normal.font.size = Pt(t.body_size)
    normal.paragraph_format.space_after = Pt(2)
    usable_width = document.sections[0].page_width - document.sections[0].left_margin - document.sections[0].right_margin

    if layout.get("name"):
        name = document.add_paragraph()
        name.alignment = WD_ALIGN_PARAGRAPH.CENTER if t.centered else WD_ALIGN_PARAGRAPH.LEFT
        run = name.add_run(str(layout["name"]))
        run.bold = True
        run.font.size = Pt(t.name_size)
        run.font.color.rgb = _rgb(t.accent)
        name.paragraph_format.space_after = Pt(1)
    if layout.get("contact"):
        contact = document.add_paragraph()
        contact.alignment = WD_ALIGN_PARAGRAPH.CENTER if t.centered else WD_ALIGN_PARAGRAPH.LEFT
        run = contact.add_run("  •  ".join(str(part) for part in layout["contact"]))
        run.font.size = Pt(t.body_size - 1)
        run.font.color.rgb = _rgb("#555555")
        contact.paragraph_format.space_after = Pt(8)

    for section in ordered_sections(layout, t):
        heading = document.add_paragraph()
        heading.paragraph_format.space_before = Pt(8)
        heading.paragraph_format.space_after = Pt(3)
        run = heading.add_run(_heading_text(str(section["title"]), t))
        run.bold = True
        run.font.size = Pt(t.body_size + 1.5)
        run.font.color.rgb = _rgb(t.accent)
        if t.rule:
            _bottom_border(heading, t.accent)
        for paragraph in section.get("paragraphs", []):
            document.add_paragraph(str(paragraph))
        for item in section.get("bullets", []):
            document.add_paragraph(str(item), style="List Bullet")
        for group in section.get("groups", []):
            line = document.add_paragraph()
            label = line.add_run(f"{group['label']}: ")
            label.bold = True
            line.add_run(", ".join(str(item) for item in group["items"]))
        for entry in section.get("entries", []):
            head = document.add_paragraph()
            head.paragraph_format.space_before = Pt(4)
            head.paragraph_format.space_after = Pt(0)
            head.paragraph_format.tab_stops.add_tab_stop(usable_width, WD_TAB_ALIGNMENT.RIGHT)
            title_run = head.add_run(str(entry.get("title") or ""))
            title_run.bold = True
            if entry.get("dates"):
                dates = head.add_run(f"\t{entry['dates']}")
                dates.font.color.rgb = _rgb("#444444")
            org = " — ".join(value for value in (entry.get("organization"), entry.get("location")) if value)
            if org:
                meta = document.add_paragraph()
                meta.paragraph_format.space_after = Pt(1)
                meta_run = meta.add_run(org)
                meta_run.italic = True
                meta_run.font.color.rgb = _rgb("#444444")
            for item in entry.get("bullets", []):
                document.add_paragraph(str(item), style="List Bullet")

    properties = document.core_properties
    properties.title = str(layout.get("name") or "Resume")
    properties.author = str(layout.get("name") or "")
    properties.created = _FIXED_TIMESTAMP
    properties.modified = _FIXED_TIMESTAMP
    properties.last_modified_by = ""
    properties.revision = 1
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()
