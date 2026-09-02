from datetime import timedelta

import pytest
from kall.clock import utcnow
from kall.models import CareerProfile, Job, JobMatch, Opportunity, User
from kall.providers.jobs import DiscoveredJob
from kall.services.discovery_matching import ingest_discovered_jobs
from sqlmodel import Session, select


def posting(**overrides):
    values = dict(source="greenhouse", external_id="42", company="Example",
                  title="Quality Engineer", description="SaaS automation", location="Remote",
                  url="https://example.test/jobs/42")
    return DiscoveredJob(**(values | overrides))


def setup(session):
    user = User(email="refresh@example.test", full_name="Refresh")
    session.add(user)
    session.flush()
    profile = CareerProfile(user_id=user.id, name="Quality", target_titles=["Quality Engineer"],
                            include_keywords=["automation"], industries=["SaaS"])
    session.add(profile)
    session.commit()
    return user, profile


def test_changed_posting_refreshes_evidence_and_decreases_score_without_losing_state(engine):
    with Session(engine) as session:
        user, profile = setup(session)
        first = ingest_discovered_jobs(session, user, profile, [posting()])
        row = session.get(Opportunity, first["opportunity_ids"][0])
        original_id, original_score = row.id, row.match_score
        row.state = "apply"
        row.notes = "Interview scheduled"
        session.add(row)
        session.commit()

        second = ingest_discovered_jobs(session, user, profile, [posting(
            title="Support Specialist", description="Help customers", location="New York",
        )])
        row = session.get(Opportunity, original_id)
        match = session.exec(select(JobMatch)).one()
        assert second["opportunity_ids"] == [original_id]
        assert second["matches_created"] == 0
        assert row.state == "apply" and row.notes == "Interview scheduled"
        assert row.match_score == match.score < original_score
        assert match.strengths == []
        assert session.exec(select(Job)).one().title == "Support Specialist"
        assert len(session.exec(select(Opportunity)).all()) == 1


def test_profile_changes_refresh_stored_matches_even_with_an_empty_feed(engine):
    with Session(engine) as session:
        user, profile = setup(session)
        ingest_discovered_jobs(session, user, profile, [posting()])
        profile.target_titles = ["Product Manager"]
        profile.include_keywords = []
        profile.industries = []
        profile.updated_at = utcnow() + timedelta(seconds=1)
        session.add(profile)
        session.commit()
        ingest_discovered_jobs(session, user, profile, [])
        match = session.exec(select(JobMatch)).one()
        row = session.exec(select(Opportunity)).one()
        assert match.score == row.match_score == 10
        assert not any("Target-title" in s for s in match.strengths)


def test_new_hard_exclusion_does_not_leave_an_eligible_historical_match(engine):
    with Session(engine) as session:
        user, profile = setup(session)
        ingest_discovered_jobs(session, user, profile, [posting()])
        row = session.exec(select(Opportunity)).one()
        row.state = "saved"
        profile.exclude_keywords = ["automation"]
        session.add(profile)
        session.add(row)
        session.commit()
        batch = ingest_discovered_jobs(session, user, profile, [posting()])
        assert batch["opportunity_ids"] == []
        assert batch["jobs_skipped"] == 1
        assert row.state == "saved" and row.match_score == 0
        match = session.exec(select(JobMatch)).one()
        assert match.score == 0 and match.gaps == ["Contains excluded keyword: automation"]


def test_material_change_preserves_dismissal_and_fingerprint_history(engine):
    with Session(engine) as session:
        user, profile = setup(session)
        ingest_discovered_jobs(session, user, profile, [posting()])
        row = session.exec(select(Opportunity)).one()
        row.state = "not_interested"
        row.dismissed_fingerprint = row.material_fingerprint
        session.add(row)
        session.commit()
        ingest_discovered_jobs(session, user, profile, [posting(description="SaaS automation with leadership")])
        assert row.state == "not_interested"
        assert row.material_fingerprint != row.dismissed_fingerprint


def test_cached_public_feed_keeps_private_matching_separate(engine):
    with Session(engine) as session:
        user, profile = setup(session)
        other = User(email="other@example.test", full_name="Other")
        session.add(other)
        session.flush()
        other_profile = CareerProfile(user_id=other.id, name="Other", exclude_keywords=["automation"])
        session.add(other_profile)
        session.commit()
        ingest_discovered_jobs(session, user, profile, [posting()])
        result = ingest_discovered_jobs(session, other, other_profile, [posting()])
        assert result["opportunity_ids"] == []
        assert session.exec(select(JobMatch)).one().user_id == user.id
        with pytest.raises(ValueError, match="belong"):
            ingest_discovered_jobs(session, other, profile, [posting()])


def test_current_exclusions_hide_historical_results_without_deleting_saved_state(client, engine):
    profile_id = client.post("/api/me/professional-profiles", json={
        "name": "Quality", "target_titles": ["Quality Engineer"],
    }).json()["id"]
    with Session(engine) as session:
        user = session.get(User, client.user_id)
        profile = session.get(CareerProfile, profile_id)
        ingest_discovered_jobs(session, user, profile, [posting()])
        row = session.exec(select(Opportunity)).one()
        row.state = "saved"
        session.add(row)
        session.commit()
    assert len(client.get(f"/api/jobs/feed?professional_profile_id={profile_id}").json()) == 1
    assert len(client.get("/api/opportunities").json()) == 1
    client.put(f"/api/me/career-profiles/{profile_id}", json={"name": "Quality", "exclude_keywords": ["automation"]})
    assert client.get(f"/api/jobs/feed?professional_profile_id={profile_id}").json() == []
    assert client.get("/api/opportunities").json() == []
    assert client.get("/api/me/morning-brief").json()["opportunities"] == []
    with Session(engine) as session:
        assert session.exec(select(Opportunity)).one().state == "saved"


def test_posting_edit_cannot_merge_another_tracked_opportunity_or_its_state(engine):
    with Session(engine) as session:
        user, profile = setup(session)
        ingest_discovered_jobs(session, user, profile, [posting(), posting(
            title="Support Specialist", url="https://example.test/jobs/43", external_id="43",
        )])
        rows = session.exec(select(Opportunity).order_by(Opportunity.id)).all()
        first, second = rows
        first.state, second.state = "saved", "apply"
        first_key, second_key = first.canonical_key, second.canonical_key
        session.add(first)
        session.add(second)
        session.commit()
        ingest_discovered_jobs(session, user, profile, [posting(title="Support Specialist")])
        assert first.state == "saved" and second.state == "apply"
        assert first.canonical_key == first_key
        assert second.canonical_key == second_key
        assert first_key != second_key
        assert len(session.exec(select(Opportunity)).all()) == 2


@pytest.mark.parametrize("changed_identity", [
    {"title": "Support Engineer"},
    {"company": "Different Company"},
    {"location": "Seattle"},
])
def test_stale_canonical_alias_cannot_absorb_a_new_posting(engine, changed_identity):
    with Session(engine) as session:
        user, profile = setup(session)
        initial = ingest_discovered_jobs(session, user, profile, [posting()])
        original = session.get(Opportunity, initial["opportunity_ids"][0])
        original.state, original.notes = "apply", "Existing application history"
        first_key, first_job_id = original.canonical_key, original.job_id
        session.add(original)
        session.commit()

        ingest_discovered_jobs(session, user, profile, [posting(**changed_identity)])
        edited_fingerprint = original.material_fingerprint
        new_result = ingest_discovered_jobs(session, user, profile, [posting(
            source="lever", external_id="43", url="https://example.test/jobs/43",
        )])
        new_opportunity = session.get(Opportunity, new_result["opportunity_ids"][0])
        assert new_opportunity.id != original.id
        assert new_opportunity.job_id != first_job_id
        assert new_opportunity.state == "new"
        assert original.job_id == first_job_id and original.canonical_key == first_key
        assert original.state == "apply" and original.notes == "Existing application history"
        assert original.material_fingerprint == edited_fingerprint
        assert len(original.source_records) == 1

        # A third source must skip the stale alias and still deduplicate with
        # the live identity, without merging either opportunity's history.
        new_opportunity.state, new_opportunity.notes = "saved", "Different opportunity"
        session.add(new_opportunity)
        session.commit()
        duplicate = ingest_discovered_jobs(session, user, profile, [posting(
            source="ashby", external_id="44", url="https://example.test/jobs/44",
            title=" Quality-Engineer ",
        )])
        assert duplicate["opportunity_ids"] == [new_opportunity.id]
        assert new_opportunity.state == "saved" and new_opportunity.notes == "Different opportunity"
        assert len(new_opportunity.source_records) == 2
        assert original.state == "apply" and len(original.source_records) == 1
        assert len(session.exec(select(Opportunity)).all()) == 2
