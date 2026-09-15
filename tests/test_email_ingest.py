"""Phase 2: fetch, classify, and match -- the AI-configured and AI-absent
paths are tested separately, matching this codebase's convention (no
OPENAI_API_KEY is set in the test environment by default, so the
rules-only tests need no monkeypatching at all; the model path
monkeypatches kall.services.email_ingest.ask_for_json directly, module-
qualified per this codebase's own documented `from X import Y` gotcha).
"""

from datetime import datetime

import pytest
from kall.models import Application, EmailConnection, EmailDetectedEvent, Job, User
from kall.services import email_ingest
from kall.services.email_ingest import (
    MailboxClient,
    RawEmailMessage,
    classify_message,
    extract_url,
    ingest_connection,
    match_application,
    passes_local_prefilter,
)
from sqlmodel import Session, select


def _message(**overrides) -> RawEmailMessage:
    defaults = dict(
        external_id="msg-1",
        sender="no-reply@boards.greenhouse.io",
        subject="Your application to Acme was received",
        snippet="Thank you for applying to the QA Engineer role.",
        body="Thank you for applying. View it here: https://boards.greenhouse.io/acme/jobs/1",
        received_at=datetime(2026, 9, 14, 12, 0, 0),
    )
    defaults.update(overrides)
    return RawEmailMessage(**defaults)


def test_prefilter_passes_a_known_ats_sender() -> None:
    assert passes_local_prefilter(_message()) is True


def test_prefilter_passes_keyword_matches_from_any_sender() -> None:
    message = _message(sender="hr@small-startup.example", subject="We regret to inform you")
    assert passes_local_prefilter(message) is True


def test_prefilter_rejects_unrelated_mail() -> None:
    message = _message(sender="newsletter@example.com", subject="Your weekly digest", snippet="Here's what's new")
    assert passes_local_prefilter(message) is False


def test_rules_classification_detects_each_event_type() -> None:
    confirmation = classify_message(_message())
    assert confirmation["is_job_related"] is True
    assert confirmation["event_type"] == "confirmation"
    assert confirmation.get("_source") != "model"

    interview = classify_message(_message(subject="Let's schedule an interview", snippet="Are you free next week to talk?"))
    assert interview["event_type"] == "interview"

    rejection = classify_message(_message(subject="Update on your application", snippet="We regret to inform you we will not be moving forward."))
    assert rejection["event_type"] == "rejection"


def test_rules_classification_reports_not_job_related_for_unmatched_text() -> None:
    result = classify_message(_message(subject="Meeting notes", snippet="See attached agenda."))
    assert result["is_job_related"] is False


def test_model_classification_is_used_when_configured(monkeypatch) -> None:
    monkeypatch.setattr(email_ingest, "ask_for_json", lambda *a, **k: {
        "is_job_related": True, "event_type": "interview", "confidence": 0.9, "company_name_guess": "Acme",
    })
    result = classify_message(_message())
    assert result["event_type"] == "interview"
    assert result["_source"] == "model"
    assert result["confidence"] == 0.9


def test_extract_url_finds_the_first_link() -> None:
    assert extract_url("Details here: https://example.com/job/1 thanks") == "https://example.com/job/1"
    assert extract_url("No link here.") is None


def _seed_application(session: Session) -> tuple[User, Application, Job]:
    user = User(email="ingest@example.com", full_name="Ingest User")
    session.add(user)
    session.commit()
    session.refresh(user)
    job = Job(source="test", company="Acme Corp", title="QA Engineer", description="...", url="https://boards.greenhouse.io/acme/jobs/1")
    session.add(job)
    session.commit()
    session.refresh(job)
    from kall.models.enums import ApplicationStatus
    application = Application(user_id=user.id, job_id=job.id, career_profile_id=1, status=ApplicationStatus.SUBMITTED)
    session.add(application)
    session.commit()
    session.refresh(application)
    return user, application, job


def test_match_application_by_url(engine) -> None:
    with Session(engine) as session:
        user, application, job = _seed_application(session)
        found = match_application(session, user.id, url=job.url, company_guess="")
        assert found is not None and found.id == application.id


def test_match_application_by_fuzzy_company_name(engine) -> None:
    with Session(engine) as session:
        user, application, _job = _seed_application(session)
        found = match_application(session, user.id, url=None, company_guess="acme")
        assert found is not None and found.id == application.id


def test_match_application_skips_closed_applications(engine) -> None:
    with Session(engine) as session:
        user, application, _job = _seed_application(session)
        from kall.models.enums import ApplicationStatus
        application.status = ApplicationStatus.WITHDRAWN
        session.add(application)
        session.commit()
        found = match_application(session, user.id, url=None, company_guess="acme")
        assert found is None


def test_match_application_returns_none_with_no_url_or_guess(engine) -> None:
    with Session(engine) as session:
        user, _application, _job = _seed_application(session)
        assert match_application(session, user.id, url=None, company_guess="") is None


class _FakeMailboxClient:
    def __init__(self, messages: list[RawEmailMessage]) -> None:
        self.messages = messages
        self.calls = 0

    async def fetch_new_messages(self, connection: EmailConnection, *, since) -> list[RawEmailMessage]:
        self.calls += 1
        return self.messages


def _connection(session: Session, user_id: int) -> EmailConnection:
    connection = EmailConnection(user_id=user_id, provider="gmail", access_token_encrypted="enc", status="connected")
    session.add(connection)
    session.commit()
    session.refresh(connection)
    return connection


@pytest.mark.asyncio
async def test_ingest_connection_creates_one_event_for_a_confirmation_and_none_for_unrelated_mail(engine) -> None:
    with Session(engine) as session:
        user, application, job = _seed_application(session)
        connection = _connection(session, user.id)
        client: MailboxClient = _FakeMailboxClient([
            _message(external_id="confirm-1"),
            _message(external_id="unrelated-1", sender="newsletter@example.com", subject="Weekly digest", snippet="news", body="no url here"),
        ])

        created = await ingest_connection(session, connection, client)

        assert len(created) == 1
        assert created[0].event_type == "confirmation"
        assert created[0].application_id == application.id

        session.refresh(connection)
        assert connection.last_synced_at is not None
        assert connection.sync_cursor is not None


@pytest.mark.asyncio
async def test_ingest_connection_never_double_processes_the_same_message(engine) -> None:
    with Session(engine) as session:
        user, _application, _job = _seed_application(session)
        connection = _connection(session, user.id)
        client = _FakeMailboxClient([_message(external_id="confirm-1")])

        await ingest_connection(session, connection, client)
        second_run = await ingest_connection(session, connection, client)

        assert second_run == []
        all_events = session.exec(select(EmailDetectedEvent)).all()
        assert len(all_events) == 1


@pytest.mark.asyncio
async def test_ingest_connection_is_a_no_op_for_a_message_that_fails_the_prefilter(engine) -> None:
    with Session(engine) as session:
        user, _application, _job = _seed_application(session)
        connection = _connection(session, user.id)
        client = _FakeMailboxClient([_message(external_id="x", sender="a@b.com", subject="hi", snippet="hi", body="hi")])

        created = await ingest_connection(session, connection, client)
        assert created == []
