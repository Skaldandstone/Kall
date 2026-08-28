"""Interview prep: nothing helped someone get ready for an interview before
this -- no question bank, no place to jot notes. No OpenAI key is configured
in tests, so every question bank here is the fixed fallback list; the AI
path itself is exercised the same way api_resume_intelligence's is, through
ask_for_json's own contract (openai_api_key unset -> fallback), not by
mocking a live call.
"""

from kall.models import Application, CareerProfile, InterviewPrep, Job
from kall.services.interview_prep import FALLBACK_QUESTIONS
from sqlmodel import Session, select

API = "/api/me/applications"


def _application(engine, user_id: int) -> int:
    with Session(engine) as session:
        job = Job(source="manual", company="Acme", title="Engineer", description="Build things.",
                  url="https://example.com/jobs/interview-prep-1")
        profile = CareerProfile(user_id=user_id, name="Default")
        session.add(job)
        session.add(profile)
        session.commit()
        session.refresh(job)
        session.refresh(profile)
        application = Application(user_id=user_id, job_id=job.id, career_profile_id=profile.id)
        session.add(application)
        session.commit()
        session.refresh(application)
        return application.id


def test_first_view_generates_a_fallback_question_bank(client, engine) -> None:
    application_id = _application(engine, client.user_id)
    response = client.get(f"{API}/{application_id}/interview-prep")
    assert response.status_code == 200, response.text
    assert response.json()["questions"] == FALLBACK_QUESTIONS
    assert response.json()["notes"] == ""


def test_the_question_bank_is_stable_across_requests(client, engine) -> None:
    """Generated once and stored, not rebuilt every request -- the questions
    should not reshuffle while someone is actively preparing with them."""
    application_id = _application(engine, client.user_id)
    first = client.get(f"{API}/{application_id}/interview-prep")
    second = client.get(f"{API}/{application_id}/interview-prep")
    assert first.json()["id"] == second.json()["id"]

    with Session(engine) as session:
        rows = list(session.exec(select(InterviewPrep).where(InterviewPrep.application_id == application_id)))
        assert len(rows) == 1


def test_saving_notes(client, engine) -> None:
    application_id = _application(engine, client.user_id)
    client.get(f"{API}/{application_id}/interview-prep")  # generates the row first

    response = client.put(f"{API}/{application_id}/interview-prep/notes", json={"notes": "Ask about on-call rotation."})
    assert response.status_code == 200, response.text
    assert response.json()["notes"] == "Ask about on-call rotation."


def test_saving_notes_before_the_question_bank_exists_is_rejected(client, engine) -> None:
    application_id = _application(engine, client.user_id)
    response = client.put(f"{API}/{application_id}/interview-prep/notes", json={"notes": "x"})
    assert response.status_code == 404


def test_interview_prep_is_scoped_to_the_owning_account(client, engine) -> None:
    from kall.models import User

    with Session(engine) as session:
        other = User(clerk_user_id="user_other_interviewer", email="other@example.com", full_name="Other")
        session.add(other)
        session.commit()
        session.refresh(other)
    application_id = _application(engine, other.id)

    response = client.get(f"{API}/{application_id}/interview-prep")
    assert response.status_code == 404
