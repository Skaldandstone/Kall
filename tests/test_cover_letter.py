from kall.models import CoverLetterChange, Job, TailoringChange, TailoringProposal
from kall.services.documents import propose_cover_letter
from kall.services.tailoring import finalize_proposal
from sqlmodel import Session, SQLModel, create_engine, select


def _session() -> Session:
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def _finalized_proposal(session: Session, job: Job) -> TailoringProposal:
    proposal = TailoringProposal(user_id=1, job_id=job.id, resume_id=1, professional_profile_id=1)
    session.add(proposal)
    session.commit()
    session.refresh(proposal)
    session.add(TailoringChange(
        proposal_id=proposal.id, section="summary", original_text="A", status="accepted",
        proposed_text="Quality engineering leader with a decade scaling automation for SaaS platforms.",
        reason="Test",
    ))
    session.add(TailoringChange(
        proposal_id=proposal.id, section="achievement", original_text="A", status="accepted",
        proposed_text="Led a 30-person QA organization and cut release defects 40% with Playwright and Python.",
        reason="Test",
    ))
    session.add(TailoringChange(
        proposal_id=proposal.id, section="achievement", original_text="A", status="accepted",
        proposed_text="Directed the migration to a Kubernetes-based CI pipeline across 40 services.",
        reason="Test",
    ))
    session.add(TailoringChange(
        proposal_id=proposal.id, section="achievement", original_text="A", status="accepted",
        proposed_text="Built a Python-based regression suite that caught 3x more defects pre-release.",
        reason="Test",
    ))
    session.commit()
    return finalize_proposal(session, proposal)


def _paragraphs(session: Session, proposal_id: int) -> list[str]:
    changes = session.exec(select(CoverLetterChange).where(CoverLetterChange.proposal_id == proposal_id)).all()
    return [change.proposed_text for change in sorted(changes, key=lambda change: change.position)]


def test_emphasis_tone_and_length_change_the_generated_paragraphs() -> None:
    """Regression test: propose_cover_letter used to write three fixed
    paragraphs regardless of what the person picked -- emphasis, tone, and
    length were stored on the row but never shaped the generated text, and
    the letter never grounded itself in more than up to two achievement
    sentences."""
    with _session() as session:
        job = Job(source="test", company="Acme", title="Director of QA", description="...", url="https://x/1")
        session.add(job)
        session.commit()
        session.refresh(job)
        finalized = _finalized_proposal(session, job)

        formal_letter = propose_cover_letter(session, finalized, "balanced", "formal", "standard", None)
        conversational_letter = propose_cover_letter(session, finalized, "balanced", "conversational", "standard", None)
        concise_letter = propose_cover_letter(session, finalized, "balanced", "formal", "concise", None)
        interested_letter = propose_cover_letter(session, finalized, "balanced", "formal", "standard", "I've followed Acme's platform work for years.")

        formal_paragraphs = _paragraphs(session, formal_letter.id)
        conversational_paragraphs = _paragraphs(session, conversational_letter.id)
        concise_paragraphs = _paragraphs(session, concise_letter.id)
        interested_paragraphs = _paragraphs(session, interested_letter.id)

    assert "Director of QA" in formal_paragraphs[0]
    assert "Acme" in formal_paragraphs[0]
    assert formal_paragraphs[0] != conversational_paragraphs[0]
    assert len(concise_paragraphs) < len(formal_paragraphs)
    assert interested_paragraphs[-1] == "I've followed Acme's platform work for years."
    assert any("Led a 30-person QA organization" in p or "Directed the migration" in p for p in formal_paragraphs)


def test_executive_emphasis_prefers_leadership_evidence_over_technical() -> None:
    with _session() as session:
        job = Job(source="test", company="Acme", title="Director of QA", description="...", url="https://x/2")
        session.add(job)
        session.commit()
        session.refresh(job)
        finalized = _finalized_proposal(session, job)

        letter = propose_cover_letter(session, finalized, "executive", "formal", "concise", None)
        paragraphs = _paragraphs(session, letter.id)

    assert "Directed the migration" in paragraphs[1] or "Led a 30-person QA organization" in paragraphs[1]
