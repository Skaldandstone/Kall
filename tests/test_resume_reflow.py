from kall.services.intelligence import parse_resume
from kall.services.resume import reflow_extracted_text


def test_word_per_line_text_is_joined_into_paragraphs_at_blank_lines() -> None:
    text = "\n".join(["James", "Shattuck", "360-809-2664", "•", "Vancouver,", "WA"]) + "\n\n" + "\n".join(
        ["Strategic", "Director", "of", "Software", "Quality", "Engineering", "with", "over", "15", "years", "of", "experience."]
    )
    assert reflow_extracted_text(text) == (
        "James Shattuck 360-809-2664 • Vancouver, WA\n\n"
        "Strategic Director of Software Quality Engineering with over 15 years of experience."
    )


def test_text_with_real_lines_is_left_alone() -> None:
    text = (
        "James Shattuck\n"
        "Senior engineer with eight years building distributed systems.\n\n"
        "Experience\n"
        "- Led the platform team at Acme, cutting release time by 40%.\n"
        "- Built the on-call rotation and the runbooks behind it.\n"
    )
    assert reflow_extracted_text(text) == text.strip()


def test_short_documents_are_never_judged_word_per_line() -> None:
    assert reflow_extracted_text("James\nShattuck\nQA") == "James\nShattuck\nQA"
    assert reflow_extracted_text("") == ""


def test_a_blank_line_between_every_word_is_not_a_paragraph_break() -> None:
    """The variant behind the mobile screenshot of 2026-09-11: pypdf put a
    blank line after every word, so treating blank lines as paragraph breaks
    turned each word into its own paragraph and the screen showed the
    resume one word to a row even after the first reflow."""
    words = [
        "James", "Shattuck", "360-809-2664", "•", "Vancouver,", "WA", "•", "jdshattuck@gmail.com",
        "Strategic", "Director", "of", "Software", "Quality", "Engineering", "with", "15", "years",
        "of", "experience.", "Experience", "Director", "of", "QA", "at", "VetsEZ.", "Skills", "Playwright",
    ]
    text = "\n\n".join(words)
    reflowed = reflow_extracted_text(text)
    assert reflowed.split("\n\n") == [
        "James Shattuck 360-809-2664 • Vancouver, WA • jdshattuck@gmail.com Strategic Director of Software Quality Engineering with 15 years of experience.",
        # The heading itself is on its own line -- parse_resume() requires a
        # heading to be a whole line, not just the start of one, to
        # recognize it as a section boundary.
        "Experience\nDirector of QA at VetsEZ.",
        "Skills\nPlaywright",
    ]
    # The same shape with a space on the blank lines behaves identically.
    assert reflow_extracted_text("\n \n".join(words)) == reflowed


def test_a_heading_ending_a_bullet_list_with_no_punctuation_before_it_still_splits() -> None:
    """Regression test, found from a real account's resume: a heading that
    follows straight off the last bullet in a list, with no period closing
    it ("...twelve testers, test engineers and test automation engineers
    Skills: Automation Frameworks: ..."), never matched the old rule, which
    required the *previous* token to end a sentence. Requiring that missed
    exactly the resumes where a bullet list runs straight into the next
    heading -- extremely common -- so the entire rest of the resume (every
    job, skills, education) fused into one page-length paragraph with the
    real "Experience:"/"Skills:"/"Education:" headings buried mid-sentence,
    and the generated resume that came out the other end had nothing but a
    summary. A heading token's own trailing colon is what actually signals
    "this is a heading" here, not what happens to precede it."""
    words = [
        "Summary", "text", "goes", "here", "with", "15", "years", "of", "experience", "and",
        "a", "team", "of", "twelve", "engineers", "Experience:", "Flock", "Safety", "-", "Director",
        "of", "QA", "Improved", "release", "quality", "significantly", "Skills:", "Python", "and",
        "AWS", "Education:", "State", "University", "2013",
    ]
    text = "\n\n".join(words)
    reflowed = reflow_extracted_text(text)
    parsed, _ = parse_resume(reflowed)
    assert "Flock Safety - Director of QA Improved release quality significantly" in parsed["sections"]["experience"]
    assert "Python and AWS" in parsed["sections"]["skills"]
    assert "State University 2013" in parsed["sections"]["education"]
    # "experience" used as an ordinary word, with nothing marking it as a
    # heading, must not itself split the summary it's part of.
    assert parsed["sections"]["unclassified"] == ["Summary text goes here with 15 years of experience and a team of twelve engineers"]
