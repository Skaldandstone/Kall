"""Department evidence against the monitoring lane's controlled public feed."""

from datetime import datetime, timedelta
from types import SimpleNamespace

import httpx
import pytest
from kall.models import (
    CareerProfile,
    DiscoverySchedule,
    JobMatch,
    NotificationPreference,
    Opportunity,
    SearchSource,
    User,
)
from sqlmodel import Session, select

monitoring = pytest.importorskip("kall.services.monitoring", reason="Requires the stacked monitoring lane")


@pytest.mark.asyncio
async def test_visible_department_change_refreshes_bonus_but_id_order_changes_never_alert(engine, monkeypatch):
    from kall.models import OpportunityNotificationEvent
    from kall.services.notifications import NotificationService

    monkeypatch.setattr(monitoring, "get_settings", lambda: SimpleNamespace(monitoring_enabled=True))
    monkeypatch.setattr(NotificationService, "send_email", lambda *a, **k: pytest.fail("No live sender"))
    now = datetime(2026, 8, 30, 12)
    payload = {"jobs": [{"id": 1, "title": "Engineer", "content": "Build systems",
                         "absolute_url": "https://example.test/jobs/1", "location": {"name": "Remote"},
                         "departments": [{"id": 1, "name": "Support"}]}]}
    with Session(engine) as session:
        user = User(email="department@example.test", full_name="Department")
        session.add(user)
        session.flush()
        profile = CareerProfile(user_id=user.id, name="Quality", target_titles=["Engineer"],
                                functional_areas=["Quality Engineering"], work_types=["remote"])
        session.add(profile)
        session.flush()
        session.add(DiscoverySchedule(user_id=user.id, professional_profile_id=profile.id, cadence="continuous"))
        session.add(NotificationPreference(user_id=user.id, minimum_match_score=50, delivery_mode="immediate"))
        session.add(SearchSource(user_id=user.id, provider="greenhouse", company_name="Example", board_key="example"))
        session.commit()
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload))) as client:
            baseline = await monitoring.run_monitoring(session, now=now, client=client)
            before = session.exec(select(JobMatch)).one().score
            assert baseline["events_queued"] == 0 and before < 50
            payload["jobs"][0]["departments"] = [{"id": 1, "name": "Support"}, {"id": 2, "name": "Quality Engineering"}]
            changed = await monitoring.run_monitoring(session, now=now + timedelta(minutes=5), client=client)
            match = session.exec(select(JobMatch)).one()
            assert changed["events_queued"] == 1 and match.score == before + 10
            assert any("department/team mentions Quality Engineering" in evidence for evidence in match.strengths)
            opportunity = session.exec(select(Opportunity)).one()
            opportunity.state, opportunity.notes = "saved", "Keep my workflow"
            session.add(opportunity)
            session.commit()
            payload["jobs"][0]["departments"] = [{"id": 80, "name": "QUALITY-ENGINEERING"}, {"id": 90, "name": "support"}]
            unchanged = await monitoring.run_monitoring(session, now=now + timedelta(minutes=10), client=client)
            assert unchanged["events_queued"] == 0
            assert len(session.exec(select(OpportunityNotificationEvent)).all()) == 1
            payload["jobs"][0]["departments"] = [{"id": 90, "name": "Support"}]
            await monitoring.run_monitoring(session, now=now + timedelta(minutes=15), client=client)
            assert session.exec(select(JobMatch)).one().score == opportunity.match_score == before
            assert opportunity.state == "saved" and opportunity.notes == "Keep my workflow"
