from collections.abc import Iterator
from datetime import date

import pytest
from fastapi.testclient import TestClient
from kall.db import get_session
from kall.main import app
from kall.models import (
    Application,
    CandidateProfile,
    CareerProfile,
    EEOProfile,
    Employment,
    FieldPrivacy,
    Job,
    User,
    WorkAuthorization,
)
from kall.models.enums import PrivacyScope
from kall.security import encrypt_sensitive
from kall.services.applications import prepare_application
from kall.services.autofill import build_autofill_pack
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select


@pytest.fixture
def engine():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    return engine


@pytest.fixture
def client(engine) -> Iterator[TestClient]:
    def override_get_session() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    try:
        with TestClient(app) as test_client:
            register = test_client.post(
                "/api/auth/register",
                json={"email": "autofill@example.com", "password": "TestPassword123!", "full_name": "Ada Lovelace"},
            )
            test_client.headers["Authorization"] = f"Bearer {register.json()['access_token']}"
            test_client.user_id = register.json()["user_id"]  # type: ignore[attr-defined]
            yield test_client
    finally:
        app.dependency_overrides.pop(get_session, None)


def _seed(engine, user_id: int, *, with_privacy_rule: bool = False, eeo_declines: bool = True) -> int:
    """Creates a fully-populated candidate and an application. Returns application id."""
    with Session(engine) as session:
        # Registration already creates a CandidateProfile (api.register), and
        # user_id is unique on that table -- update it rather than insert.
        profile_row = session.exec(
            select(CandidateProfile).where(CandidateProfile.user_id == user_id)
        ).first() or CandidateProfile(user_id=user_id)
        profile_row.city = "Austin"
        profile_row.state_region = "Texas"
        profile_row.country = "United States"
        profile_row.linkedin_url = "https://linkedin.com/in/ada"
        profile_row.github_url = "https://github.com/ada"
        profile_row.phone_encrypted = encrypt_sensitive("+1-555-0100")
        profile_row.address_encrypted = encrypt_sensitive("1 Analytical Engine Way")
        profile_row.postal_code_encrypted = encrypt_sensitive("78701")
        session.add(profile_row)
        session.add(Employment(
            user_id=user_id, employer="Northwind Systems", job_title="Senior Backend Engineer",
            start_date=date(2020, 1, 1), is_current=True,
        ))
        session.add(EEOProfile(
            user_id=user_id,
            veteran_status_encrypted=encrypt_sensitive("Not a veteran"),
            decline_to_answer_defaults=eeo_declines,
        ))
        session.add(WorkAuthorization(
            user_id=user_id, country="United States", authorization_type="Citizen",
            citizenship_status_encrypted=encrypt_sensitive("US Citizen"),
            requires_current_sponsorship=False, requires_future_sponsorship=False,
        ))
        if with_privacy_rule:
            session.add(FieldPrivacy(
                user_id=user_id, field_path="identity.phone", scopes=[PrivacyScope.AUTOFILL.value],
            ))
        job = Job(source="test", company="Acme Robotics", title="Staff Engineer",
                  description="Build things.", url="https://boards.example.com/jobs/1")
        profile = CareerProfile(user_id=user_id, name="Backend Leadership")
        session.add(job)
        session.add(profile)
        session.commit()
        session.refresh(job)
        session.refresh(profile)
        user = session.get(User, user_id)
        application = prepare_application(session, user, job, profile, None)
        return application.id


def _pack(engine, user_id: int, application_id: int) -> dict:
    with Session(engine) as session:
        user = session.get(User, user_id)
        application = session.get(Application, application_id)
        return build_autofill_pack(session, user, application)


def _paths(pack: dict) -> set[str]:
    return {row["path"] for row in pack["fields"]}


def _omitted(pack: dict) -> dict[str, str]:
    return {row["path"]: row["reason"] for row in pack["omitted"]}


def test_always_tier_fields_are_filled_without_any_privacy_rule(client: TestClient, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    application_id = _seed(engine, user_id)
    pack = _pack(engine, user_id, application_id)

    filled = {row["path"]: row["value"] for row in pack["fields"]}
    assert filled["identity.legal_name"] == "Ada Lovelace"
    assert filled["identity.email"] == "autofill@example.com"
    assert filled["identity.linkedin_url"] == "https://linkedin.com/in/ada"
    assert filled["employment.current_employer"] == "Northwind Systems"
    assert filled["employment.current_title"] == "Senior Backend Engineer"


def test_opt_in_field_is_withheld_until_a_privacy_rule_grants_autofill(client: TestClient, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    pack = _pack(engine, user_id, _seed(engine, user_id, with_privacy_rule=False))

    assert "identity.phone" not in _paths(pack)
    assert "privacy settings" in _omitted(pack)["identity.phone"]


def test_opt_in_field_is_filled_once_granted(client: TestClient, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    pack = _pack(engine, user_id, _seed(engine, user_id, with_privacy_rule=True))

    filled = {row["path"]: row["value"] for row in pack["fields"]}
    assert filled["identity.phone"] == "+1-555-0100"
    # Granting phone must not leak the neighbouring opt-in fields.
    assert "identity.address" not in filled


def test_work_authorization_always_requires_confirmation(client: TestClient, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    pack = _pack(engine, user_id, _seed(engine, user_id))

    rows = {row["path"]: row for row in pack["fields"] if row["path"].startswith("work_authorization.")}
    assert rows, "work authorization should be present for confirmation"
    assert all(row["requires_confirmation"] for row in rows.values())


def test_eeo_is_not_pre_answered_when_the_profile_declines_by_default(client: TestClient, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    pack = _pack(engine, user_id, _seed(engine, user_id, eeo_declines=True))

    assert not [row for row in pack["fields"] if row["path"].startswith("eeo.")]
    assert "eeo.veteran_status" in _omitted(pack)


def test_eeo_still_requires_confirmation_even_when_a_privacy_rule_grants_autofill(client: TestClient, engine) -> None:
    """The strongest guarantee: a user cannot accidentally configure their way
    into silently auto-answering EEO. The tier overrides any FieldPrivacy row."""
    user_id = client.user_id  # type: ignore[attr-defined]
    application_id = _seed(engine, user_id, eeo_declines=False)
    with Session(engine) as session:
        session.add(FieldPrivacy(
            user_id=user_id, field_path="eeo.veteran_status", scopes=[PrivacyScope.AUTOFILL.value],
        ))
        session.commit()

    pack = _pack(engine, user_id, application_id)
    veteran = next(row for row in pack["fields"] if row["path"] == "eeo.veteran_status")
    assert veteran["value"] == "Not a veteran"
    assert veteran["requires_confirmation"] is True


def test_missing_values_are_reported_with_a_reason_rather_than_dropped(client: TestClient, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    with Session(engine) as session:
        job = Job(source="test", company="Acme", title="Engineer", description="d",
                  url="https://boards.example.com/jobs/2")
        profile = CareerProfile(user_id=user_id, name="Bare")
        session.add(job)
        session.add(profile)
        session.commit()
        session.refresh(job)
        session.refresh(profile)
        application = prepare_application(session, job=job, user=session.get(User, user_id),
                                          career_profile=profile, resume=None)
        application_id = application.id

    pack = _pack(engine, user_id, application_id)
    omitted = _omitted(pack)
    # No CandidateProfile at all, so every sourced field should be explained.
    assert "identity.linkedin_url" in omitted
    assert "No value saved" in omitted["identity.linkedin_url"]
    assert "documents.resume" in omitted


def test_prepare_application_populates_the_previously_empty_preview_sections(client: TestClient, engine) -> None:
    """build_preview() reads these three keys; before this feature nothing wrote them."""
    user_id = client.user_id  # type: ignore[attr-defined]
    application_id = _seed(engine, user_id)
    with Session(engine) as session:
        payload = session.get(Application, application_id).prepared_payload

    assert payload["work_authorization"]["authorization_type"] == "Citizen"
    assert payload["work_authorization"]["confirmation_required"] is True
    assert payload["eeo"]["confirmation_required"] is True
    assert "screening_answers" in payload


def test_prepared_payload_never_stores_decrypted_sensitive_values(client: TestClient, engine) -> None:
    """prepared_payload is a plaintext JSON column and gets checksummed into the
    immutable submission preview -- writing decrypted PII there would undo the
    encryption at rest that the models bother to do."""
    user_id = client.user_id  # type: ignore[attr-defined]
    application_id = _seed(engine, user_id, with_privacy_rule=True)
    with Session(engine) as session:
        serialized = str(session.get(Application, application_id).prepared_payload)

    for secret in ("+1-555-0100", "1 Analytical Engine Way", "78701", "US Citizen", "Not a veteran"):
        assert secret not in serialized


def test_autofill_pack_endpoint_rejects_another_users_application(client: TestClient, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    application_id = _seed(engine, user_id)

    other = client.post(
        "/api/auth/register",
        json={"email": "intruder@example.com", "password": "TestPassword123!", "full_name": "Mallory"},
    )
    response = client.get(
        f"/api/applications/{application_id}/autofill-pack",
        headers={"Authorization": f"Bearer {other.json()['access_token']}"},
    )
    assert response.status_code == 404


def test_profile_resources_accept_iso_date_strings(client: TestClient) -> None:
    """Regression: the generic resource store passed request values straight
    into the SQLModel constructor, which does no coercion, so any date-bearing
    profile resource died with "SQLite Date type only accepts Python date
    objects". Every date field on every resource was unwritable."""
    created = client.post(
        "/api/profile/resources/employment",
        json={"data": {
            "employer": "Northwind Systems", "job_title": "Senior Backend Engineer",
            "start_date": "2020-01-01", "is_current": True,
        }},
    )
    assert created.status_code == 200, created.text
    assert created.json()["start_date"] == "2020-01-01"

    education = client.post(
        "/api/profile/resources/education",
        json={"data": {"institution": "MIT", "degree": "BS", "graduation_date": "2015-06-01"}},
    )
    assert education.status_code == 200, education.text
    assert education.json()["graduation_date"] == "2015-06-01"

    patched = client.patch(
        f"/api/profile/resources/employment/{created.json()['id']}",
        json={"data": {"end_date": "2024-03-31", "is_current": False}},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["end_date"] == "2024-03-31"
    assert patched.json()["is_current"] is False
    # Untouched fields survive the round-trip through model_validate.
    assert patched.json()["employer"] == "Northwind Systems"


def test_profile_resources_still_reject_unknown_fields(client: TestClient) -> None:
    created = client.post(
        "/api/profile/resources/employment",
        json={"data": {"employer": "Acme", "job_title": "Engineer"}},
    )
    response = client.patch(
        f"/api/profile/resources/employment/{created.json()['id']}",
        json={"data": {"not_a_real_column": "x"}},
    )
    assert response.status_code == 422


def test_resume_download_rejects_another_users_resume(client: TestClient, engine) -> None:
    upload = client.post(
        "/api/me/resumes",
        files={"file": ("resume.txt", b"Ada Lovelace\nSenior Backend Engineer", "text/plain")},
    )
    assert upload.status_code == 200
    resume_id = upload.json()["id"]

    mine = client.get(f"/api/me/resumes/{resume_id}/download")
    assert mine.status_code == 200
    assert mine.content == b"Ada Lovelace\nSenior Backend Engineer"

    other = client.post(
        "/api/auth/register",
        json={"email": "intruder2@example.com", "password": "TestPassword123!", "full_name": "Mallory"},
    )
    theirs = client.get(
        f"/api/me/resumes/{resume_id}/download",
        headers={"Authorization": f"Bearer {other.json()['access_token']}"},
    )
    assert theirs.status_code == 404
