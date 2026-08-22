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
    create_tailoring_proposal,
    finalize_proposal,
    preserves_immutable_facts,
    review_change,
)
from sqlmodel import Session, SQLModel, create_engine


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
