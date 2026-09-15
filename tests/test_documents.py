import time
from datetime import timedelta
from pathlib import Path

import pytest
from kall.clock import utcnow
from kall.models import GeneratedDocument, Job, TailoringChange, TailoringProposal, User
from kall.services import documents
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
        assert content == [{"section": "summary", "text": "Accepted", "original": "Old"}]


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


def test_selected_layout_changes_section_order_and_rejects_unknown_layouts() -> None:
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        proposal = _finalized_proposal(session)
        session.add(TailoringChange(proposal_id=proposal.id, section="experience", original_text="", proposed_text="Experience", reason="verified", status="accepted"))
        session.add(TailoringChange(proposal_id=proposal.id, section="achievement", original_text="", proposed_text="Achievement", reason="verified", status="accepted"))
        session.commit()

        creative = generate_resume_documents(session, proposal, "creative")
        assert [item["section"] for item in creative.content_json["sections"]] == ["summary", "achievement", "experience"]
        with pytest.raises(ValueError, match="available resume layouts"):
            generate_resume_documents(session, proposal, "unknown")


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
        original.created_at = utcnow() - timedelta(days=ARTIFACT_RETENTION_DAYS + 1)
        session.add(original)
        session.commit()
        assert expire_artifacts(session) == 1
        assert not Path(original.file_path).exists()

        # The document is untouched and the file rebuilds byte for byte.
        assert session.get(GeneratedDocument, generated.id) is not None
        rebuilt = ensure_artifact(session, generated, "pdf")
        assert Path(rebuilt.file_path).read_bytes() == original_bytes
        assert rebuilt.checksum == original_checksum


def test_a_render_version_bump_reaches_documents_generated_before_it(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Regression test: ensure_artifact's storage key used to be pure
    content -- user/document/format -- with nothing tying it to the code
    that produced the bytes. A resume rendered before a rendering bug fix
    (the embedded bullet font, a font-encoding fix, anything in
    render_pdf/render_docx) would keep passing `storage.exists(...)` and
    serving its pre-fix bytes on every future download, forever, no matter
    how many times the renderer got fixed afterward -- exactly the shape of
    bug a "why does this resume still show the old problem" report points
    at. RENDER_VERSION in the storage key is what makes a version bump
    actually reach documents that already exist."""
    monkeypatch.chdir(tmp_path)
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        generated = generate_resume_documents(session, _finalized_proposal(session))

        monkeypatch.setattr(documents, "RENDER_VERSION", 1)
        monkeypatch.setattr(documents, "render_artifact", lambda doc, fmt: f"pre-fix-{fmt}".encode())
        before_fix = ensure_artifact(session, generated, "pdf")
        # Captured as a plain string: ensure_artifact reuses the same
        # DocumentArtifact row (and therefore the same Python object, via
        # SQLAlchemy's identity map) on the next call below, mutating
        # `before_fix.file_path` in place -- comparing the live attribute
        # afterward would silently compare the object to itself.
        before_fix_path = before_fix.file_path
        assert Path(before_fix_path).read_bytes() == b"pre-fix-pdf"

        # The renderer changes -- some real fix lands in render_pdf -- and
        # the version is bumped to mark that.
        monkeypatch.setattr(documents, "RENDER_VERSION", 2)
        monkeypatch.setattr(documents, "render_artifact", lambda doc, fmt: f"post-fix-{fmt}".encode())
        after_fix = ensure_artifact(session, generated, "pdf")

        assert Path(after_fix.file_path).read_bytes() == b"post-fix-pdf", (
            "a document generated before the version bump kept serving pre-fix bytes"
        )
        assert after_fix.file_path != before_fix_path


def test_expiry_leaves_recent_files_alone(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        generated = generate_resume_documents(session, _finalized_proposal(session))
        ensure_artifact(session, generated, "pdf")
        assert expire_artifacts(session) == 0


def test_documents_list_is_scoped_to_the_signed_in_account(client, engine) -> None:
    """There was no way to find a generated document again except through the
    id an application happened to record. The list returns the account's own
    documents newest first, with the job and application they belong to."""
    from kall.models import Application, CareerProfile
    from kall.models.enums import ApplicationStatus

    with Session(engine) as session:
        other = User(clerk_user_id="user_other_docs", email="other-docs@example.com", full_name="Other")
        session.add(other)
        session.commit()
        session.refresh(other)
        job = Job(source="test", company="North", title="Director", description="Lead quality", url="https://example.com/list")
        session.add(job)
        session.commit()
        session.refresh(job)
        profile = CareerProfile(user_id=client.user_id, name="Quality")
        session.add(profile)
        session.commit()
        session.refresh(profile)
        mine = TailoringProposal(user_id=client.user_id, job_id=job.id, resume_id=1, professional_profile_id=profile.id, status="finalized", finalized_at=job.created_at)
        theirs = TailoringProposal(user_id=other.id, job_id=job.id, resume_id=1, professional_profile_id=profile.id, status="finalized", finalized_at=job.created_at)
        session.add(mine)
        session.add(theirs)
        session.commit()
        session.refresh(mine)
        session.refresh(theirs)
        for proposal in (mine, theirs):
            session.add(TailoringChange(proposal_id=proposal.id, section="summary", original_text="Old", proposed_text="New", reason="verified", status="accepted"))
        session.commit()
        generated = generate_resume_documents(session, mine)
        generate_resume_documents(session, theirs)
        application = Application(user_id=client.user_id, job_id=job.id, career_profile_id=profile.id, status=ApplicationStatus.APPROVED)
        session.add(application)
        session.commit()
        session.refresh(application)
        generated_id, application_id = generated.id, application.id

    response = client.get("/api/documents")
    assert response.status_code == 200, response.text
    body = response.json()
    assert [item["id"] for item in body] == [generated_id]
    assert body[0]["company"] == "North" and body[0]["title"] == "Director"
    assert body[0]["application_id"] == application_id
    assert body[0]["document_type"] == "resume"
