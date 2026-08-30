"""Synthetic pilot measurement. Temporary SQLite, fixed feeds, no credentials or senders."""

import asyncio
import json
import sys
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import httpx
from kall.models import CareerProfile, DiscoverySchedule, NotificationPreference, SearchSource, User
from kall.services import monitoring
from sqlmodel import Session, SQLModel, create_engine


async def measure():
    monitoring.get_settings = lambda: SimpleNamespace(monitoring_enabled=True)
    cycle = 0

    def handler(request):
        board = request.url.path.split("/")[-2]
        if cycle == 1:
            return httpx.Response(304)
        rows = [
            {
                "id": f"{board}-{i}",
                "title": f"Engineer {board} {i}",
                "content": "Build reliable Python software.",
                "location": {"name": "Remote"},
                "absolute_url": f"https://example.test/{board}/{i}",
            }
            for i in range(20)
        ]
        if cycle == 2:
            rows[0]["content"] += " Salary $140,000."
            rows.append(
                {
                    **rows[-1],
                    "id": f"{board}-new",
                    "title": f"Engineer {board} new",
                    "absolute_url": f"https://example.test/{board}/new",
                }
            )
        return httpx.Response(200, json={"jobs": rows}, headers={"etag": str(cycle)})

    with tempfile.TemporaryDirectory(prefix="kall-monitoring-") as directory:
        db = create_engine(f"sqlite:///{Path(directory) / 'benchmark.sqlite'}")
        SQLModel.metadata.create_all(db)
        with Session(db) as session:
            for i in range(5):
                user = User(
                    clerk_user_id=f"synthetic-{i}",
                    email=f"synthetic-{i}@example.test",
                    full_name="Synthetic",
                )
                session.add(user)
                session.flush()
                profile = CareerProfile(
                    user_id=user.id, name=f"Profile {i}", target_titles=["Engineer"]
                )
                session.add(profile)
                session.flush()
                session.add(
                    DiscoverySchedule(
                        user_id=user.id, professional_profile_id=profile.id, cadence="continuous"
                    )
                )
                session.add(
                    NotificationPreference(
                        user_id=user.id, minimum_match_score=0, delivery_mode="immediate"
                    )
                )
                for board in range(10):
                    session.add(
                        SearchSource(
                            user_id=user.id,
                            provider="greenhouse",
                            company_name=f"Board {board}",
                            board_key=f"board{board}",
                        )
                    )
            session.commit()
            results = []
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                for index in range(3):
                    cycle = index
                    started = time.perf_counter()
                    result = await monitoring.run_monitoring(
                        session,
                        now=datetime(2026, 8, 30, 12) + timedelta(minutes=5 * index),
                        client=client,
                    )
                    result["measured_wall_seconds"] = round(time.perf_counter() - started, 3)
                    results.append(result)
        db.dispose()
    return {
        "fixture": "5 profiles sharing 10 boards, 20 postings each; baseline, 304, then one new and one material change per board",
        "external_requests": 0,
        "sender": "disabled",
        "database": "temporary SQLite",
        "cpu_limit": "unconstrained developer host, not Fargate",
        "cycles": results,
    }


if __name__ == "__main__":
    result = asyncio.run(measure())
    output = Path(__file__).resolve().parents[1] / "docs/continuation/monitoring-benchmark.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
