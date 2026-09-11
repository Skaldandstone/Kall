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
