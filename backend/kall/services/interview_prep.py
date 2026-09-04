"""Interview prep: company context, a question bank with per-question
guidance, and good questions to ask back -- per application.

Nothing helped someone prepare for an interview before this. This remains
the AI-inference cut: company_context and answer_prompt content is the
model reasoning over the job posting's own title/company/description, not
real company research (no web search, no scraping) -- see the module
docstring on models.application_review.InterviewPrep for why the UI must
label it as an estimate. Falls back to a fixed, generic bank when no AI key
is configured, the same "silence is not an option" rule services/
openai_json.py exists to enforce elsewhere.

The practice quiz samples a subset of the (deliberately larger) generated
question_bank client-side for "retake with variance" without a fresh AI
call every time, then grades submitted long-form answers in one batched
call (grade_quiz_answers) against each question's own answer_prompt as the
rubric. Grading has no deterministic fallback -- there is no honest way to
score an answer without a model -- so the caller must degrade to an
ungraded self-check when AI is unavailable, not invent a score.
"""

from kall.config import get_settings
from kall.models import Job, JobRequirementAnalysis
from kall.services.openai_json import ask_for_json

#: A deeper pool than any one quiz attempt uses (see api_applications.py's
#: quiz sampling), so retaking the quiz draws a different combination of
#: questions each time without needing a fresh AI call per retake.
_MAX_QUESTIONS = 15
_MAX_QUESTIONS_TO_ASK = 9
_MAX_GRADED_ANSWERS = 8

_FALLBACK_PREP = {
    "company_context": {
        "likely_product": "Not available",
        "likely_tech_stack": [],
        "summary": "Company-specific context needs an OpenAI key configured -- these are generic prompts instead.",
    },
    "question_bank": [
        {
            "question": q,
            "category": "general",
            "answer_prompt": "Structure your answer around a specific example: the situation, what you did, and the outcome.",
            "resources": [],
        }
        for q in [
            "Tell me about yourself and what draws you to this role.",
            "Walk me through a project you're proud of and your specific contribution.",
            "Describe a time you disagreed with a teammate or manager. How did you handle it?",
            "Tell me about a mistake you made and what you learned from it.",
            "Why this company, and why this role specifically?",
            "Where do you want your career to be in a few years?",
        ]
    ],
    "questions_to_ask": [
        {"stage": "phone screen", "question": "What does a typical day in this role look like?"},
        {"stage": "phone screen", "question": "What made you decide to open this role now?"},
        {"stage": "technical/onsite", "question": "How is the team structured, and who would I work with most closely?"},
        {"stage": "technical/onsite", "question": "What are the biggest challenges the team is facing right now?"},
        {"stage": "final round", "question": "What does success look like in the first 90 days?"},
        {"stage": "final round", "question": "How is performance evaluated on this team?"},
    ],
}


def _company_prompt_context(job: Job, analysis: JobRequirementAnalysis | None) -> str:
    requirements = ", ".join((analysis.required_skills if analysis else [])[:10]) or "not specified"
    return (
        f"Role: {job.title} at {job.company}\n"
        f"Job description: {job.description[:4000]}\n"
        f"Key requirements: {requirements}"
    )


_SCHEMA = {
    "type": "object",
    "properties": {
        "company_context": {
            "type": "object",
            "properties": {
                "likely_product": {"type": "string"},
                "likely_tech_stack": {"type": "array", "maxItems": 8, "items": {"type": "string"}},
                "summary": {"type": "string"},
            },
            "required": ["likely_product", "likely_tech_stack", "summary"],
            "additionalProperties": False,
        },
        "question_bank": {
            "type": "array",
            "maxItems": _MAX_QUESTIONS,
            "items": {
                "type": "object",
                "properties": {
                    "question": {"type": "string"},
                    "category": {"type": "string"},
                    "answer_prompt": {"type": "string"},
                    "resources": {"type": "array", "maxItems": 3, "items": {"type": "string"}},
                },
                "required": ["question", "category", "answer_prompt", "resources"],
                "additionalProperties": False,
            },
        },
        "questions_to_ask": {
            "type": "array",
            "maxItems": _MAX_QUESTIONS_TO_ASK,
            "items": {
                "type": "object",
                "properties": {
                    "stage": {"type": "string"},
                    "question": {"type": "string"},
                },
                "required": ["stage", "question"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["company_context", "question_bank", "questions_to_ask"],
    "additionalProperties": False,
}


def generate_interview_prep(job: Job, analysis: JobRequirementAnalysis | None) -> tuple[dict, bool]:
    """(prep, used_ai). prep always has company_context/question_bank/
    questions_to_ask, falling back to _FALLBACK_PREP if AI is not
    configured or fails.
    """
    settings = get_settings()
    if not settings.openai_api_key:
        return _FALLBACK_PREP, False

    prompt = (
        "You are helping a candidate prepare for an interview. Using only the job posting details below, "
        "infer the company's likely product and tech stack, generate a mixed behavioral/technical question "
        "bank, and suggest good questions for the candidate to ask back at different interview stages "
        "(e.g. phone screen, technical/onsite, final round).\n\n"
        "Be explicit in company_context.summary that this is your best inference from the posting, not "
        "verified research -- the candidate should still look the company up themselves. For each question "
        "in question_bank, answer_prompt should guide HOW to structure a strong answer (e.g. which "
        "framework or what to cover), never a scripted answer or invented personal experience. resources "
        "should name concrete topics or concepts worth reviewing beforehand, not links.\n\n"
        f"{_company_prompt_context(job, analysis)}"
    )
    parsed = ask_for_json(prompt, schema_name="interview_prep", schema=_SCHEMA, purpose="interview prep")
    if parsed is None:
        return _FALLBACK_PREP, False

    question_bank = [
        item for item in parsed.get("question_bank", [])
        if isinstance(item, dict) and isinstance(item.get("question"), str) and item["question"].strip()
    ]
    if not question_bank:
        return _FALLBACK_PREP, False

    questions_to_ask = [
        item for item in parsed.get("questions_to_ask", [])
        if isinstance(item, dict) and isinstance(item.get("question"), str) and item["question"].strip()
    ]
    company_context = parsed.get("company_context")
    if not isinstance(company_context, dict):
        company_context = _FALLBACK_PREP["company_context"]

    return {
        "company_context": company_context,
        "question_bank": question_bank[:_MAX_QUESTIONS],
        "questions_to_ask": questions_to_ask[:_MAX_QUESTIONS_TO_ASK],
    }, True


_GRADE_SCHEMA = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "score_percent": {"type": "integer", "minimum": 0, "maximum": 100},
                    "feedback": {"type": "string"},
                    "missed_points": {"type": "array", "maxItems": 5, "items": {"type": "string"}},
                    "additional_resources": {"type": "array", "maxItems": 3, "items": {"type": "string"}},
                },
                "required": ["score_percent", "feedback", "missed_points", "additional_resources"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["results"],
    "additionalProperties": False,
}


def grade_quiz_answers(
    job: Job,
    analysis: JobRequirementAnalysis | None,
    submissions: list[dict],
) -> list[dict] | None:
    """Grades free-text quiz answers against each question's own
    answer_prompt as the rubric. Returns one result per submission, in the
    same order, or None if AI is not configured or the call fails -- there
    is no meaningful deterministic fallback for grading, unlike the
    generation path, so the caller must degrade to an ungraded self-check
    instead of inventing a score.

    `submissions` is [{question, category, answer_prompt, candidate_answer}, ...].
    """
    settings = get_settings()
    if not settings.openai_api_key or not submissions:
        return None

    items = submissions[:_MAX_GRADED_ANSWERS]
    transcript = "\n\n".join(
        f"Q{i + 1} ({item['category']}): {item['question']}\n"
        f"What a strong answer covers: {item['answer_prompt']}\n"
        f"Candidate's answer: {item['candidate_answer'] or '(left blank)'}"
        for i, item in enumerate(items)
    )
    prompt = (
        "Grade each candidate answer below against what a strong answer for that question should cover. "
        "Score honestly on a 0-100 scale -- a blank or off-topic answer scores near 0, a solid but "
        "incomplete answer scores 50-75, only a genuinely thorough answer scores above 85. In feedback, "
        "be specific and constructive, not just encouraging. missed_points lists concrete things the "
        "answer should have addressed but didn't. additional_resources names concrete topics worth "
        "reviewing given what was missed -- not links, and not a repeat of what the candidate already got "
        "right. Return exactly one result per question, in the same order.\n\n"
        f"ROLE:\n{_company_prompt_context(job, analysis)}\n\n"
        f"ANSWERS TO GRADE:\n{transcript}"
    )
    parsed = ask_for_json(prompt, schema_name="interview_quiz_grading", schema=_GRADE_SCHEMA, purpose="interview quiz grading")
    if parsed is None:
        return None

    results = parsed.get("results")
    if not isinstance(results, list) or len(results) != len(items):
        return None
    return results
