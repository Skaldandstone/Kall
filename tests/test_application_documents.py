"""prepare_application used to write generic, non-personalized placeholder
text to a hardcoded .txt path -- no AI tailoring, no ATS formatting, and
nothing for a person to actually review before applying. It now starts a
real tailoring proposal through the same evidence-grounded pipeline used by
/tailoring and /resumes, so the review step has real per-paragraph content
and ends in an actual ATS-formatted PDF/DOCX (see services/documents.py).
"""

from kall.models import CareerProfile, Job, ResumeDocument, ResumeSelection, User
from kall.services.applications import prepare_application
from sqlmodel import Session, select


def _job(session: Session) -> Job:
    job = Job(
        source="test", company="Acme Robotics", title="Staff Backend Engineer",
        description="Required: Python. Preferred: Kubernetes.",
        url="https://boards.example.com/jobs/1",
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


def _resume(session: Session, user_id: int, name: str = "resume.txt") -> ResumeDocument:
    resume = ResumeDocument(
        user_id=user_id, name=name, file_path=f"uploads/{user_id}/{name}",
        mime_type="text/plain", extracted_text="Built Python services at scale.",
    )
    session.add(resume)
    session.commit()
    session.refresh(resume)
    return resume


def _profile(session: Session, user_id: int) -> CareerProfile:
    profile = CareerProfile(user_id=user_id, name="Backend")
    session.add(profile)
    session.commit()
    session.refresh(profile)
    return profile


def test_prepare_application_starts_a_real_tailoring_proposal_when_a_resume_is_present(engine) -> None:
    with Session(engine) as session:
        user = User(clerk_user_id="user_ada", email="ada@example.com", full_name="Ada")
        session.add(user)
        session.commit()
        session.refresh(user)
        job = _job(session)
        resume = _resume(session, user.id)
        profile = _profile(session, user.id)

        application = prepare_application(session, user, job, profile, resume)

        proposal_id = application.prepared_payload["tailoring_proposal_id"]
        assert proposal_id is not None
        # No more placeholder .txt path -- that field is unused by this flow now.
        assert application.customized_resume_path is None


def test_prepare_application_leaves_the_proposal_id_unset_without_a_resume(engine) -> None:
    with Session(engine) as session:
        user = User(clerk_user_id="user_bob", email="bob@example.com", full_name="Bob")
        session.add(user)
        session.commit()
        session.refresh(user)
        job = _job(session)
        profile = _profile(session, user.id)

        application = prepare_application(session, user, job, profile, None)

        assert application.prepared_payload["tailoring_proposal_id"] is None


def test_prepare_application_skips_the_proposal_when_neither_document_is_requested(engine) -> None:
    with Session(engine) as session:
        user = User(clerk_user_id="user_cleo", email="cleo@example.com", full_name="Cleo")
        session.add(user)
        session.commit()
        session.refresh(user)
        job = _job(session)
        resume = _resume(session, user.id)
        profile = _profile(session, user.id)

        application = prepare_application(
            session, user, job, profile, resume,
            customize_resume=False, generate_cover_letter=False,
        )

        assert application.prepared_payload["tailoring_proposal_id"] is None


def test_prepare_application_honors_the_resume_actually_chosen_on_the_form(engine) -> None:
    """rank_resumes recommends whichever resume scores highest; the person
    may have picked a different one in the apply form's dropdown. That
    choice must win, the same way the manual override endpoint works."""
    with Session(engine) as session:
        user = User(clerk_user_id="user_dot", email="dot@example.com", full_name="Dot")
        session.add(user)
        session.commit()
        session.refresh(user)
        job = _job(session)
        _recommended = _resume(session, user.id, "generic.txt")
        chosen = _resume(session, user.id, "python-focused.txt")
        # Give the chosen resume no particular ranking advantage -- either
        # could be "recommended"; what matters is prepare_application must
        # still honor whichever one was passed in explicitly.
        profile = _profile(session, user.id)

        prepare_application(session, user, job, profile, chosen)

        selection = session.exec(
            select(ResumeSelection).where(
                ResumeSelection.user_id == user.id,
                ResumeSelection.job_id == job.id,
                ResumeSelection.professional_profile_id == profile.id,
            )
        ).first()
        assert selection is not None
        assert selection.selected_resume_id == chosen.id


def test_get_application_exposes_prepared_payload_for_the_review_ui(client) -> None:
    profile_id = client.post("/api/me/professional-profiles", json={"name": "Backend"}).json()["id"]
    job_id = client.post("/api/jobs", json={
        "source": "test", "company": "Acme", "title": "Engineer",
        "description": "Required: Python.", "url": "https://boards.example.com/jobs/2",
    }).json()["id"]
    prepared = client.post("/api/applications/prepare-options", json={
        "job_id": job_id, "professional_profile_id": profile_id, "resume_id": None,
        "customize_resume": True, "generate_cover_letter": False, "application_mode": "assisted",
    })
    assert prepared.status_code == 200, prepared.text
    application_id = prepared.json()["id"]

    fetched = client.get(f"/api/applications/{application_id}")
    assert fetched.status_code == 200
    assert "tailoring_proposal_id" in fetched.json()["prepared_payload"]


def test_link_generated_documents_merges_into_prepared_payload(client) -> None:
    profile_id = client.post("/api/me/professional-profiles", json={"name": "Backend"}).json()["id"]
    job_id = client.post("/api/jobs", json={
        "source": "test", "company": "Acme", "title": "Engineer",
        "description": "Required: Python.", "url": "https://boards.example.com/jobs/3",
    }).json()["id"]
    application_id = client.post("/api/applications/prepare-options", json={
        "job_id": job_id, "professional_profile_id": profile_id, "resume_id": None,
        "customize_resume": False, "generate_cover_letter": False, "application_mode": "assisted",
    }).json()["id"]

    linked = client.patch(f"/api/applications/{application_id}/generated-documents", json={
        "cover_letter_proposal_id": 42,
    })
    assert linked.status_code == 200, linked.text
    assert linked.json()["prepared_payload"]["cover_letter_proposal_id"] == 42

    fetched = client.get(f"/api/applications/{application_id}")
    assert fetched.json()["prepared_payload"]["cover_letter_proposal_id"] == 42
