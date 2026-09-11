from datetime import date

from kall.models import (
    Employment,
    Job,
    JobRequirementAnalysis,
    ResumeDocument,
    ResumeSelection,
    TailoringChange,
    User,
)
from kall.services.documents import generate_resume_documents, preview_layout, render_preview_png
from kall.services.role_gaps import RoleContext, find_gaps, suggest_role_gaps
from kall.services.tailoring import create_tailoring_proposal, finalize_proposal, review_all
from sqlmodel import Session, SQLModel, create_engine, select


def _session() -> Session:
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def _seed(session: Session):
    user = User(email="gaps@example.com", full_name="Gap Person")
    session.add(user)
    session.commit()
    session.refresh(user)
    job = Job(source="test", company="North", title="Director of QA", description="Lead quality", url="https://example.com/gaps")
    session.add(job)
    session.commit()
    session.refresh(job)
    session.add(JobRequirementAnalysis(job_id=job.id, required_skills=["Playwright", "FedRAMP"], preferred_skills=["Kubernetes"]))
    resume = ResumeDocument(user_id=user.id, name="r.txt", file_path="x", mime_type="text/plain", extracted_text="Led QA using Playwright.")
    session.add(resume)
    session.commit()
    session.refresh(resume)
    session.add(ResumeSelection(user_id=user.id, job_id=job.id, professional_profile_id=1, selected_resume_id=resume.id))
    session.add(Employment(user_id=user.id, employer="North", job_title="QA Lead", start_date=date(2020, 1, 1), is_current=True, description="Owned Playwright automation."))
    session.add(Employment(user_id=user.id, employer="Acme", job_title="Tester", start_date=date(2016, 1, 1), end_date=date(2019, 12, 1), description="Manual regression."))
    session.commit()
    return user, job


def test_find_gaps_lists_unmentioned_requirements_per_role_unsupported_first() -> None:
    roles = [RoleContext(employment_id=1, employer="North", title="QA Lead", dates="", text="Owned Playwright automation.")]
    gaps = find_gaps(roles, ["Playwright", "FedRAMP", "Kubernetes"], resume_text="Led QA using Playwright.")
    assert gaps == {1: ["FedRAMP", "Kubernetes"]}


def test_rules_suggestions_ask_a_question_and_draft_a_bullet_without_inventing_facts() -> None:
    roles = [RoleContext(employment_id=7, employer="North", title="QA Lead", dates="2020 – Present", text="")]
    gaps = suggest_role_gaps("Director of QA", "North", roles, {7: ["FedRAMP"]})
    assert len(gaps) == 1
    assert gaps[0].source == "rules"
    assert "FedRAMP" in gaps[0].prompt and "QA Lead" in gaps[0].prompt
    assert "[describe the outcome" in gaps[0].suggestion


def test_proposal_carries_one_pending_suggestion_per_role_gap() -> None:
    with _session() as session:
        user, job = _seed(session)
        proposal = create_tailoring_proposal(session, user.id, job, 1)
        changes = list(session.exec(select(TailoringChange).where(TailoringChange.proposal_id == proposal.id)))
        role_changes = [change for change in changes if change.section.startswith("role:")]
        # North already shows Playwright, so it is asked about FedRAMP and
        # Kubernetes; Acme shows none of the three.
        by_role: dict[str, list[str]] = {}
        for change in role_changes:
            by_role.setdefault(change.section, []).append(change.evidence[0]["requirement"])
        assert sorted(by_role[next(k for k in by_role if by_role[k] == ["FedRAMP", "Kubernetes"])]) == ["FedRAMP", "Kubernetes"]
        assert any(sorted(reqs) == ["FedRAMP", "Kubernetes", "Playwright"] for reqs in by_role.values())
        assert all(change.status == "pending" and change.original_text == "" for change in role_changes)
        assert all(change.reason.endswith("?") for change in role_changes)


def test_bulk_review_then_finalize_places_approved_bullets_under_their_role() -> None:
    with _session() as session:
        user, job = _seed(session)
        proposal = create_tailoring_proposal(session, user.id, job, 1)
        touched = review_all(session, proposal, "accepted", "role:")
        assert touched and all(change.status == "accepted" for change in touched)
        # The summary change is still pending, so finalize refuses...
        try:
            finalize_proposal(session, proposal)
            raise AssertionError("finalize should require every change reviewed")
        except ValueError:
            pass
        review_all(session, proposal, "rejected")
        finalize_proposal(session, proposal)
        generated = generate_resume_documents(session, proposal, "executive")
        layout = generated.content_json["layout"]
        experience = next(section for section in layout["sections"] if section["key"] == "experience")
        north = next(entry for entry in experience["entries"] if entry["organization"] == "North")
        assert "Owned Playwright automation." in north["bullets"]
        assert any("FedRAMP" in bullet for bullet in north["bullets"])
        acme = next(entry for entry in experience["entries"] if entry["organization"] == "Acme")
        assert any("Playwright" in bullet for bullet in acme["bullets"])


def test_preview_renders_the_current_draft_as_a_png_before_finalizing() -> None:
    with _session() as session:
        user, job = _seed(session)
        proposal = create_tailoring_proposal(session, user.id, job, 1)
        layout = preview_layout(session, proposal, "standard")
        assert layout["name"] == "Gap Person"
        png = render_preview_png(layout, "standard", dpi=40)
        assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_review_all_and_preview_and_save_to_profile_over_the_api(client) -> None:
    from kall.db import get_session
    from kall.main import app

    override = app.dependency_overrides[get_session]
    session = next(override())
    me = client.get("/api/me").json()
    job = Job(source="test", company="North", title="Director of QA", description="Lead quality", url="https://example.com/api-gaps")
    session.add(job)
    session.commit()
    session.refresh(job)
    session.add(JobRequirementAnalysis(job_id=job.id, required_skills=["FedRAMP"], preferred_skills=[]))
    resume = ResumeDocument(user_id=me["id"], name="r.txt", file_path="x", mime_type="text/plain", extracted_text="Led QA.")
    session.add(resume)
    session.commit()
    session.refresh(resume)
    session.add(ResumeSelection(user_id=me["id"], job_id=job.id, professional_profile_id=1, selected_resume_id=resume.id))
    session.add(Employment(user_id=me["id"], employer="North", job_title="QA Lead", start_date=date(2020, 1, 1), is_current=True, description="Owned automation."))
    session.commit()

    created = client.post("/api/tailoring/proposals", json={"job_id": job.id, "professional_profile_id": 1})
    assert created.status_code == 200, created.text
    proposal_id = created.json()["id"]

    preview = client.get(f"/api/tailoring/{proposal_id}/previews/executive.png")
    assert preview.status_code == 200 and preview.headers["content-type"] == "image/png"
    assert client.get(f"/api/tailoring/{proposal_id}/previews/nope.png").status_code == 404

    bulk = client.post(f"/api/tailoring/proposals/{proposal_id}/review-all", json={"status": "accepted"})
    assert bulk.status_code == 200 and bulk.json()["reviewed"] >= 2
    assert client.post(f"/api/tailoring/proposals/{proposal_id}/finalize").status_code == 200
    generated = client.post(f"/api/tailoring/{proposal_id}/documents", json={"template_key": "executive"})
    assert generated.status_code == 200, generated.text
    document_id = generated.json()["id"]

    assert client.get(f"/api/documents/{document_id}/preview.png").headers["content-type"] == "image/png"
    saved = client.post(f"/api/documents/{document_id}/save-to-profile")
    assert saved.status_code == 200, saved.text
    assert saved.json()["resume"]["name"] == "North – Director of QA (tailored).pdf"
    studio = client.get("/api/me/resume-studio").json()
    assert any(row["name"].endswith("(tailored).pdf") for row in studio["resumes"])
