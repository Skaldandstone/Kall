import time
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from kall.models import GeneratedDocument, Job, TailoringChange, TailoringProposal, User
from kall.services.documents import (
    ARTIFACT_RETENTION_DAYS,
    ensure_artifact,
    expire_artifacts,
    finalized_resume_content,
    generate_resume_documents,
    offered_artifacts,
    render_artifact,
)
from sqlmodel import Session, SQLModel, create_engine


def test_finalized_content_excludes_rejected_changes() -> None:
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        user = User(email="docs@example.com", full_name="Docs User")
        session.add(user)
        session.commit()
        session.refresh(user)
        job = Job(source="test", company="North", title="Director", description="Lead quality", url="https://example.com/docs")
        session.add(job)
        session.commit()
        session.refresh(job)
        proposal = TailoringProposal(
            user_id=user.id,
            job_id=job.id,
            resume_id=1,
            professional_profile_id=1,
            status="finalized",
            finalized_at=job.created_at,
        )
        session.add(proposal)
        session.commit()
        session.refresh(proposal)
        session.add(TailoringChange(proposal_id=proposal.id, section="summary", original_text="Old", proposed_text="Accepted", reason="match", status="accepted"))
        session.add(TailoringChange(proposal_id=proposal.id, section="achievement", original_text="Old", proposed_text="Rejected", reason="match", status="rejected"))
        session.commit()
        content = finalized_resume_content(session, proposal)
        assert content == [{"section": "summary", "text": "Accepted"}]


def _finalized_proposal(session, engine=None):
    """A finalized proposal ready to generate documents from."""
    user = User(email="files@example.com", full_name="Files User")
    session.add(user)
    session.commit()
    session.refresh(user)
    job = Job(source="test", company="North", title="Director", description="Lead quality", url="https://example.com/files")
    session.add(job)
    session.commit()
    session.refresh(job)
    proposal = TailoringProposal(user_id=user.id, job_id=job.id, resume_id=1, professional_profile_id=1, status="finalized", finalized_at=job.created_at)
    session.add(proposal)
    session.commit()
    session.refresh(proposal)
    session.add(TailoringChange(proposal_id=proposal.id, section="summary", original_text="Led releases", proposed_text="Led releases with 99% uptime", reason="verified", immutable_tokens=["99%"], status="accepted"))
    session.commit()
    return proposal


def test_a_generated_document_is_immediately_finalized() -> None:
    """Regression test: status defaulted to "generated" and nothing ever
    advanced it to "finalized" -- build_preview() (services/submissions.py)
    filters on exactly that status, so a submission's document_checksums
    was always {}, and the check comparing it against a resubmission's
    current checksums could never actually catch a resume that changed
    after approval. finalized_at was already set here; status just wasn't.
    """
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        generated = generate_resume_documents(session, _finalized_proposal(session))
        assert generated.status == "finalized"


def test_generation_writes_no_files_until_one_is_asked_for(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Three formats were rendered eagerly for a document nobody had opened."""
    monkeypatch.chdir(tmp_path)
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        proposal = _finalized_proposal(session)
        generated = generate_resume_documents(session, proposal)

        assert not (tmp_path / "generated").exists(), "nothing should be rendered yet"
        # The record of what was generated is complete regardless.
        assert generated.content_json["sections"]
        assert generated.checksum


def test_every_format_is_offered_and_rendered_on_request(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        generated = generate_resume_documents(session, _finalized_proposal(session))

        offered = offered_artifacts(session, generated)
        assert {row["format"] for row in offered} == {"txt", "docx", "pdf"}
        assert all(row["byte_size"] is None for row in offered), "none rendered yet"

        pdf = ensure_artifact(session, generated, "pdf")
        assert Path(pdf.file_path).read_bytes().startswith(b"%PDF")
        assert "99%" in Path(ensure_artifact(session, generated, "txt").file_path).read_text()
        assert ensure_artifact(session, generated, "docx").byte_size > 0

        sizes = {row["format"]: row["byte_size"] for row in offered_artifacts(session, generated)}
        assert all(size and size > 0 for size in sizes.values())


def test_asking_twice_does_not_render_twice(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        generated = generate_resume_documents(session, _finalized_proposal(session))
        first = ensure_artifact(session, generated, "pdf")
        second = ensure_artifact(session, generated, "pdf")
        assert first.id == second.id


def test_rendering_is_reproducible(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """The property the whole retention design rests on.

    If a re-render produced different bytes, expiring a file would silently
    replace someone's document with a near-copy, and the checksum shown next
    to it would be unverifiable.
    """
    monkeypatch.chdir(tmp_path)
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        generated = generate_resume_documents(session, _finalized_proposal(session))
        for fmt in ("txt", "docx", "pdf"):
            first = render_artifact(generated, fmt)
            time.sleep(1.1)  # cross a filesystem/zip timestamp tick
            assert render_artifact(generated, fmt) == first, f"{fmt} is not reproducible"


def test_an_expired_artifact_comes_back_identical(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        generated = generate_resume_documents(session, _finalized_proposal(session))
        original = ensure_artifact(session, generated, "pdf")
        original_checksum = original.checksum
        original_bytes = Path(original.file_path).read_bytes()

        # Age it past the window and run the retention job.
        original.created_at = datetime.utcnow() - timedelta(days=ARTIFACT_RETENTION_DAYS + 1)
        session.add(original)
        session.commit()
        assert expire_artifacts(session) == 1
        assert not Path(original.file_path).exists()

        # The document is untouched and the file rebuilds byte for byte.
        assert session.get(GeneratedDocument, generated.id) is not None
        rebuilt = ensure_artifact(session, generated, "pdf")
        assert Path(rebuilt.file_path).read_bytes() == original_bytes
        assert rebuilt.checksum == original_checksum


def test_expiry_leaves_recent_files_alone(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        generated = generate_resume_documents(session, _finalized_proposal(session))
        ensure_artifact(session, generated, "pdf")
        assert expire_artifacts(session) == 0
