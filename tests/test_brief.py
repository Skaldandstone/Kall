"""build_morning_brief, extracted from api_brief.py so the emailed version
(notification_delivery.py) and the in-app page share exactly one
implementation. Had no test coverage before this -- these pin down the
"what does someone see first" logic, which is the part most likely to be
touched carelessly later.
"""

from kall.models import Application, CandidateProfile, CareerProfile, Job, JobMatch, User
from kall.models.enums import ApplicationStatus
from kall.services.brief import build_morning_brief
from sqlmodel import Session


def _user(session, email="brief@example.com", full_name="Ada Lovelace"):
    user = User(clerk_user_id=f"user_{email}", email=email, full_name=full_name)
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def test_a_brand_new_account_is_pointed_at_a_resume_first(engine) -> None:
    with Session(engine) as session:
        user = _user(session)
        brief = build_morning_brief(session, user)

        assert brief["focus"]["kind"] == "resume"
        assert brief["user"]["preferred_name"] == "Ada"
        assert brief["applications"]["total"] == 0
        assert brief["resumes"]["total"] == 0


def test_preferred_name_from_the_candidate_profile_wins_over_full_name(engine) -> None:
    with Session(engine) as session:
        user = _user(session)
        session.add(CandidateProfile(user_id=user.id, preferred_name="Lovelace"))
        session.commit()

        brief = build_morning_brief(session, user)
        assert brief["user"]["preferred_name"] == "Lovelace"


def test_an_approved_application_is_the_most_actionable_thing_shown(engine) -> None:
    """Ready-to-fill outranks even a strong opportunity match -- it is the
    one thing in the brief with nothing left to decide, only to do."""
    with Session(engine) as session:
        user = _user(session)
        job = Job(source="test", company="Acme", title="Engineer", description="x", url="https://example.com/brief-job")
        session.add(job)
        session.commit()
        session.refresh(job)
        profile = CareerProfile(user_id=user.id, name="Default")
        session.add(profile)
        session.commit()
        session.refresh(profile)
        session.add(JobMatch(
            user_id=user.id, job_id=job.id, career_profile_id=profile.id,
            score=95, recommendation="Strong fit",
        ))
        approved = Application(user_id=user.id, career_profile_id=profile.id, base_resume_id=1, job_id=job.id, status=ApplicationStatus.APPROVED)
        session.add(approved)
        session.commit()
        session.refresh(approved)

        brief = build_morning_brief(session, user)

        assert brief["focus"]["kind"] == "autofill"
        assert brief["focus"]["href"] == f"/applications/{approved.id}"
        assert brief["applications"]["ready_to_autofill"] == 1


def test_a_paused_profile_does_not_count_toward_direction(engine) -> None:
    """The same is_active flag the Strategy tab's pause button controls --
    a paused profile should not make the brief think there is a live
    direction when there is not."""
    with Session(engine) as session:
        user = _user(session)
        session.add(CareerProfile(user_id=user.id, name="Paused", target_titles=["Staff Engineer"], is_active=False))
        session.commit()

        brief = build_morning_brief(session, user)

        direction = next(d for d in brief["career_health"]["dimensions"] if d["label"] == "Direction")
        assert direction["score"] == 0, "an inactive profile's target titles must not count"
        assert direction["measured"] is False


def test_a_brand_new_account_has_nothing_measured_yet(engine) -> None:
    """Every dimension used to fall back to an invented 25-35% floor, so an
    account with no applications showed "30% application momentum". No
    evidence means 0 and an explanation that says it is unmeasured."""
    with Session(engine) as session:
        user = _user(session)
        brief = build_morning_brief(session, user)
        for dimension in brief["career_health"]["dimensions"]:
            assert dimension["score"] == 0
            assert dimension["measured"] is False
            assert dimension["explanation"].startswith("Not measured yet")
        assert brief["career_health"]["score"] == 0


def test_career_health_is_the_average_of_its_own_dimensions(engine) -> None:
    with Session(engine) as session:
        user = _user(session)
        session.add(CareerProfile(user_id=user.id, name="Live", target_titles=["Staff Engineer"]))
        session.commit()
        brief = build_morning_brief(session, user)
        dims = brief["career_health"]["dimensions"]
        direction = next(d for d in dims if d["label"] == "Direction")
        assert direction["measured"] is True and direction["score"] == 72
        assert brief["career_health"]["score"] == round(sum(d["score"] for d in dims) / len(dims))
