from kall.models import ResumeDocument
from kall.services.resume_proofreading import proofreading_gaps


def resume_readiness(resume: ResumeDocument) -> tuple[int, list[str], list[str]]:
    """Return the single product-wide resume readiness score and its reasons.

    This measures whether Kall has enough readable, labeled evidence to match
    and tailor. It is not a score against one job description.
    """
    strengths: list[str] = []
    gaps: list[str] = []
    score = 20
    text_length = len((resume.extracted_text or "").strip())
    if text_length >= 1200:
        score += 30
        strengths.append("Substantial resume text is available for matching and tailoring.")
    elif text_length >= 400:
        score += 18
        strengths.append("Resume text was extracted successfully.")
    else:
        gaps.append("Upload a text-readable PDF or DOCX with fuller experience detail.")
    if resume.target_titles:
        score += 15
        strengths.append("Target roles are defined.")
    else:
        gaps.append("Add target titles so Kall can evaluate role alignment.")
    if resume.industries:
        score += 10
        strengths.append("Industry focus is tagged.")
    else:
        gaps.append("Add one or more target industries.")
    if resume.tags:
        score += 10
        strengths.append("Searchable skill and specialization tags are present.")
    else:
        gaps.append("Add skill or specialization tags.")
    if resume.is_default:
        score += 10
        strengths.append("This is the default resume.")
    if resume.version > 1:
        score += 5
        strengths.append("The resume has version history.")
    content_gaps = proofreading_gaps(resume.extracted_text or "")
    gaps.extend(content_gaps)
    score -= 8 * len(content_gaps)
    return max(min(score, 100), 0), strengths, gaps
