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
        "Experience Director of QA at VetsEZ.",
        "Skills Playwright",
    ]
    # The same shape with a space on the blank lines behaves identically.
    assert reflow_extracted_text("\n \n".join(words)) == reflowed
