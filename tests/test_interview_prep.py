"""Interview prep: nothing helped someone get ready for an interview before
this -- no question bank, no company context, no questions to ask back, no
place to jot notes. No OpenAI key is configured in tests, so every
generation here is the fixed fallback bank; the AI path itself is exercised
the same way api_resume_intelligence's is, through ask_for_json's own
contract (openai_api_key unset -> fallback), not by mocking a live call.
"""

from kall.models import Application, CareerProfile, InterviewPrep, Job
from kall.services.interview_prep import _FALLBACK_PREP
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


def test_first_view_generates_a_fallback_prep(client, engine) -> None:
    application_id = _application(engine, client.user_id)
    response = client.get(f"{API}/{application_id}/interview-prep")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["question_bank"] == _FALLBACK_PREP["question_bank"]
    assert body["questions_to_ask"] == _FALLBACK_PREP["questions_to_ask"]
    assert body["company_context"] == _FALLBACK_PREP["company_context"]
    assert body["questions"] == [item["question"] for item in _FALLBACK_PREP["question_bank"]]
    assert body["notes"] == ""


def test_the_prep_is_stable_across_requests(client, engine) -> None:
    """Generated once and stored, not rebuilt every request -- the content
    should not reshuffle while someone is actively preparing with it."""
    application_id = _application(engine, client.user_id)
    first = client.get(f"{API}/{application_id}/interview-prep")
    second = client.get(f"{API}/{application_id}/interview-prep")
    assert first.json()["id"] == second.json()["id"]

    with Session(engine) as session:
        rows = list(session.exec(select(InterviewPrep).where(InterviewPrep.application_id == application_id)))
        assert len(rows) == 1


def test_regenerate_replaces_content_but_keeps_notes(client, engine) -> None:
    application_id = _application(engine, client.user_id)
    client.get(f"{API}/{application_id}/interview-prep")
    client.put(f"{API}/{application_id}/interview-prep/notes", json={"notes": "Ask about on-call rotation."})

    response = client.post(f"{API}/{application_id}/interview-prep/regenerate")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["notes"] == "Ask about on-call rotation."
    assert body["question_bank"] == _FALLBACK_PREP["question_bank"]

    with Session(engine) as session:
        rows = list(session.exec(select(InterviewPrep).where(InterviewPrep.application_id == application_id)))
        assert len(rows) == 1


def test_regenerate_without_an_existing_prep_creates_one(client, engine) -> None:
    application_id = _application(engine, client.user_id)
    response = client.post(f"{API}/{application_id}/interview-prep/regenerate")
    assert response.status_code == 200, response.text
    assert response.json()["question_bank"] == _FALLBACK_PREP["question_bank"]


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


def test_a_real_ai_generation_consumes_the_ai_actions_quota(client, engine, monkeypatch) -> None:
    """Regression test: get_interview_prep never called assert_ai_allowed/
    record_ai_action at all, unlike every other AI-cost endpoint
    (api_growth.py, api_resume_intelligence.py) -- a Free-plan user could
    trigger an unmetered AI generation per application with no weekly cap
    and no consumption recorded."""
    import json

    import httpx
    from kall.config import get_settings
    from kall.services.quota import snapshot

    payload = {
        "company_context": {"likely_product": "Widgets", "likely_tech_stack": ["Python"], "summary": "Inferred from the posting."},
        "question_bank": [{"question": "What drew you to this role?", "category": "general", "answer_prompt": "Be specific.", "resources": []}],
        "questions_to_ask": [{"stage": "phone screen", "question": "What does success look like?"}],
    }

    class FakeResponse:
        status_code = 200

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"output_text": json.dumps(payload)}

    monkeypatch.setattr(httpx, "post", lambda *args, **kwargs: FakeResponse())
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    get_settings.cache_clear()
    try:
        application_id = _application(engine, client.user_id)
        response = client.get(f"{API}/{application_id}/interview-prep")
        assert response.status_code == 200, response.text
        assert response.json()["question_bank"] == payload["question_bank"]
        assert response.json()["questions"] == ["What drew you to this role?"]

        with Session(engine) as session:
            from kall.models import User

            user = session.get(User, client.user_id)
            assert snapshot(session, user)["meters"]["ai_actions"]["used"] == 1
    finally:
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        get_settings.cache_clear()


def test_a_free_fallback_never_consumes_the_ai_actions_quota(client, engine) -> None:
    """No OpenAI key configured -- the fallback bank is free, and must not
    be metered the same way a real AI call would be."""
    from kall.models import User
    from kall.services.quota import snapshot

    application_id = _application(engine, client.user_id)
    client.get(f"{API}/{application_id}/interview-prep")

    with Session(engine) as session:
        user = session.get(User, client.user_id)
        assert snapshot(session, user)["meters"]["ai_actions"]["used"] == 0


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
