import pytest
from kall.models import (
    Job,
    ResumeDocument,
    ResumeSelection,
    TailoringChange,
    TailoringProposal,
    User,
)
from kall.services.documents import finalized_resume_content
from kall.services.tailoring import (
    _find_summary_paragraph,
    create_tailoring_proposal,
    finalize_proposal,
    preserves_immutable_facts,
    review_change,
)
from sqlmodel import Session, SQLModel, create_engine


def test_summary_paragraph_skips_a_pdf_header_block_split_across_blank_lines() -> None:
    """Regression test: pypdf extraction split a resume header into
    "James\\n\\nShattuck\\n\\n360-809-2664", and the naive first-paragraph
    heuristic proposed editing that instead of an actual summary -- garbled
    text that could never look like an improvement."""
    text = (
        "James\n\n"
        "Shattuck\n\n"
        "360-809-2664\n\n"
        "Senior engineer with eight years building distributed systems and leading cross-functional teams.\n\n"
        "Experience\n\n"
        "Led the platform team at Acme."
    )
    assert _find_summary_paragraph(text) == (
        "Senior engineer with eight years building distributed systems and leading cross-functional teams."
    )


def test_summary_paragraph_skips_an_email_only_line() -> None:
    text = "james@example.com\n\nReal summary paragraph with plenty of actual words in it."
    assert _find_summary_paragraph(text) == "Real summary paragraph with plenty of actual words in it."


def test_summary_paragraph_falls_back_to_the_first_block_when_nothing_else_qualifies() -> None:
    """A resume with no real summary section (every block is short/contact-
    shaped) should not raise or return empty -- just proposing against the
    header is still better than proposing against nothing."""
    text = "James\n\nShattuck\n\n360-809-2664"
    assert _find_summary_paragraph(text) == "James"


def test_summary_paragraph_skips_a_skills_and_education_inventory_block() -> None:
    """Regression test: a resume's "Languages & Tools" list followed by an
    education block reads as long, contact-free prose by word count alone,
    so the header-noise check waved it through as "the summary" -- producing
    a garbled proposal that mashed a skills list into an education GPA line
    instead of touching the real narrative summary below it."""
    text = (
        "James Shattuck\n\n"
        "Languages & Tools: Java, JavaScript, TypeScript, Python, React, Node.js, "
        "AWS, Docker, Kubernetes, PostgreSQL, Terraform. Education: B.S. Computer "
        "Science, State University, GPA: 3.7\n\n"
        "Head of Quality Engineering with a decade of experience scaling test "
        "strategies for SaaS, FinTech, and IoT platforms.\n\n"
        "Experience\n\n"
        "Led the platform team at Acme."
    )
    assert _find_summary_paragraph(text) == (
        "Head of Quality Engineering with a decade of experience scaling test "
        "strategies for SaaS, FinTech, and IoT platforms."
    )


def test_summary_paragraph_handles_empty_text() -> None:
    assert _find_summary_paragraph("") == ""


def test_immutable_metrics_and_dates_are_preserved() -> None:
    original = "Improved uptime to 99% in 2024 and saved $250,000."
    assert preserves_immutable_facts(original, "In 2024, improved uptime to 99% and saved $250,000.")
    assert not preserves_immutable_facts(original, "Improved uptime to 100% in 2025 and saved $500,000.")


def test_review_rejects_metric_mutation() -> None:
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        proposal = TailoringProposal(user_id=1, job_id=1, resume_id=1, professional_profile_id=1)
        session.add(proposal)
        session.commit()
        session.refresh(proposal)
        change = TailoringChange(
            proposal_id=proposal.id,
            section="achievement",
            original_text="Raised automation to 80% in 2023.",
            proposed_text="Raised automation to 80% in 2023.",
            reason="Aligned evidence",
        )
        session.add(change)
        session.commit()
        session.refresh(change)
        with pytest.raises(ValueError):
            review_change(session, change, "edited", "Raised automation to 95% in 2024.")


def test_finalize_requires_every_change_reviewed() -> None:
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        proposal = TailoringProposal(user_id=1, job_id=1, resume_id=1, professional_profile_id=1)
        session.add(proposal)
        session.commit()
        session.refresh(proposal)
        session.add(TailoringChange(proposal_id=proposal.id, section="summary", original_text="A", proposed_text="A", reason="Test"))
        session.commit()
        with pytest.raises(ValueError):
            finalize_proposal(session, proposal)


def test_finalize_proposal_sets_status_documents_service_expects() -> None:
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        proposal = TailoringProposal(user_id=1, job_id=1, resume_id=1, professional_profile_id=1)
        session.add(proposal)
        session.commit()
        session.refresh(proposal)
        change = TailoringChange(proposal_id=proposal.id, section="summary", original_text="A", proposed_text="A", reason="Test", status="accepted")
        session.add(change)
        session.commit()

        finalized = finalize_proposal(session, proposal)

        assert finalized.status == "finalized"
        assert finalized.id is not None
        # finalized_resume_content() is the consumer this status must satisfy;
        # a mismatched status string here previously made document generation
        # permanently unreachable after finalization.
        assert finalized_resume_content(session, finalized) == [{"section": "summary", "text": "A"}]


def test_created_proposal_survives_session_close() -> None:
    """Regression test: create_tailoring_proposal used to leave the returned
    proposal's attributes expired after its trailing commit, with no refresh
    before return. Once the caller's session closed (as happens between a
    FastAPI request finishing and its response_model being serialized), every
    attribute access raised, and the API silently responded with `{}`."""
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        user = User(email="proposal-survive@example.com", full_name="Survive User")
        session.add(user)
        session.commit()
        session.refresh(user)
        job = Job(source="test", company="North", title="Director", description="Lead quality", url="https://example.com/survive")
        session.add(job)
        session.commit()
        session.refresh(job)
        resume = ResumeDocument(user_id=user.id, name="resume.txt", file_path="uploads/1/resume.txt", mime_type="text/plain", extracted_text="Led quality initiatives.")
        session.add(resume)
        session.commit()
        session.refresh(resume)
        session.add(ResumeSelection(user_id=user.id, job_id=job.id, professional_profile_id=1, selected_resume_id=resume.id))
        session.commit()

        job_id = job.id
        proposal = create_tailoring_proposal(session, user.id, job, 1)
        proposal_id = proposal.id

    # Session is closed here, mirroring a request-scoped session ending
    # before FastAPI serializes the response_model=TailoringProposal object.
    assert proposal.id == proposal_id
    assert proposal.status == "review_required"
    assert proposal.job_id == job_id


def test_summary_paragraph_reflows_word_per_line_extraction_and_drops_the_contact_header() -> None:
    """Regression test: a designed PDF came out of pypdf as one word per
    line with single newlines, so the whole header plus summary was a single
    "paragraph" and the mobile review showed "James / Shattuck / 360-809-2664
    / • / Vancouver, ..." one word to a row as the text to improve."""
    words = (
        ["James", "Shattuck", "360-809-2664", "•", "Vancouver,", "WA", "•", "jdshattuck@gmail.com"]
        + [""]
        + ["Strategic", "Director", "of", "Software", "Quality", "Engineering", "with", "over", "15", "years", "of", "experience", "delivering", "high-impact", "quality", "strategies."]
    )
    text = "\n".join(words)
    summary = _find_summary_paragraph(text)
    assert summary.startswith("Strategic Director of Software Quality Engineering")
    assert "\n" not in summary
    assert "jdshattuck" not in summary


def test_summary_paragraph_strips_a_contact_header_sharing_the_paragraph() -> None:
    text = (
        "James Shattuck 360-809-2664 • Vancouver, WA • jdshattuck@gmail.com • Strategic Director of Software "
        "Quality Engineering with over 15 years of experience."
    )
    assert _find_summary_paragraph(text) == (
        "Strategic Director of Software Quality Engineering with over 15 years of experience."
    )
