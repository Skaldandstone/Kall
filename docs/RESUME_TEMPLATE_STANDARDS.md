# Resume template standards

What free, published ATS-template guides agree on, checked against what
`resume_render.py`/`resume_assembly.py`/`ats_check.py` actually do, so this is
written down once instead of re-derived from scratch next time a "look" or a
new kind of suggestion is added.

Sources: [Jobscan's ATS templates](https://www.jobscan.co/resume-templates/ats-templates),
[Resume.io's ATS format guide](https://resume.io/resume-templates/ats),
[JobMentis's resume structure guide](https://www.jobmentis.com/en/guide/resume-structure).

## What the guides agree on, and where Kall stands today

| Guideline | Kall's implementation |
| --- | --- |
| Single column, top-to-bottom reading order | `render_pdf`/`render_docx` build one linear story/flow; no multi-column frames exist anywhere in either renderer. |
| Name first, then contact, in the body (never a header/footer) | `render_pdf` appends name and contact as the first two flowables in `story`, not in a `SimpleDocTemplate` header/footer callback. `ats_check.py`'s `name` check enforces this on every generated PDF. |
| Standard section headings | `resume_assembly._SECTION_TITLES` and `ats_check.STANDARD_HEADINGS` are two lists maintained separately, so they can drift -- see `test_ats_check.py` for the guard that keeps every title Kall actually renders inside the recognized set. `intelligence._SECTION_ALIASES` does the mirror-image job for *parsing* a variety of real-world headings back in. |
| No images, icons, or graphics carrying real content | `ats_check.py`'s `no_images` check counts embedded XObjects on every generated PDF and fails if there are any. |
| Standard fonts, no custom glyph-only faces | `ats_check.py`'s `_STANDARD_FONTS` allowlist; bullets specifically are drawn from an embedded TrueType face (`_ensure_bullet_font`) rather than a base-14 Type1 font, because those have no Unicode bullet glyph and extract as a control character otherwise. |
| Avoid tables/columns for page structure | True for a layout table spanning the page. It is **not** true for the one place Kall uses a `Table`: a single-row, two-cell row holding a job title and its date range. Tested directly against `pypdf` (the same library `ats_check.py` uses): the table extracts as two cleanly separated lines in the right order. The seemingly more "table-free" alternative -- a single `Paragraph` with a right tab stop, matching what `render_docx` already does with `WD_TAB_ALIGNMENT.RIGHT` -- was tried and extracts as `"...EngineeringMar 2019 - Present"` with **no space between the two runs** in ReportLab 4.5.1, because a `<tab/>` moves the drawing cursor without emitting a real whitespace character into the content stream. The table is the more ATS-reliable choice for this one case; do not "fix" it into a tab stop without re-testing extraction first. |
| Contact separators/punctuation must exist in the font's encoding | The PDF contact line uses a middle dot (`·`, U+00B7 -- inside WinAnsiEncoding, the base-14 default) rather than a bullet (`•`, outside it), fixed for exactly this reason in the same commit that added the embedded bullet font. `render_docx`'s contact line still uses `•`, which is fine there: DOCX stores runs as literal Unicode text, not font-glyph indices, so there's no encoding gap to hit. |
| DOCX for unknown ATS, text-layer PDF otherwise | Kall renders both from the same `layout`, byte-for-byte reproducibly (`test_every_template_renders_a_real_document_deterministically`), so there's no "the PDF version is the good one" gap. |

## Section order

Every guide agrees on Contact → Summary → Experience → Education, with Skills
placed either right after Summary or near the end depending on the source --
there's no universal rule there, only "somewhere logical, never split across
the page." Kall doesn't hardcode one order: `Treatment.section_order` (in
`resume_render.py`) is a per-look tuple, and `ordered_sections()` renders
whatever `assemble_resume()` produced in that order, skipping any section
with no content. All eight looks agree on the guides' one hard rule --
Contact and Summary come first -- and differ only on Skills/Achievements
placement relative to Experience, which is a style choice, not an ATS one.

## Where a new suggestion actually lands

This is the part worth being explicit about: **every** piece of content Kall
proposes -- the drafted summary, a reworded achievement, a role-gap bullet
answered "yes" -- flows through the same `tailored_sections` list into
`assemble_resume()` (`resume_assembly.py`), which is the only place that
decides which of the fixed section keys (`summary`, `experience`,
`achievements`, `skills`, `education`, `certifications`, `awards`,
`publications`, `patents`, `languages`, `projects`) a piece of text lands
under. A suggestion never picks its own placement or formatting -- it can
only supply text for a section `assemble_resume()` already knows how to
render, in whichever position the chosen look puts that section. Adding a
new *kind* of suggestion never needs new rendering logic; it needs a
`tailored_sections` entry tagged with an existing section key (or
`role:<employment_id>`, for a bullet under a specific job).
