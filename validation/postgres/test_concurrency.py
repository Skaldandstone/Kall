"""Actual competing connections, never a shared SQLite connection."""

import asyncio
import hashlib
import hmac
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from threading import Barrier

from billing_fakes import SECRET
from fastapi import HTTPException
from kall.api_billing import webhook
from kall.models import BillingEvent, User
from kall.services import work_claims
from sqlmodel import Session, select
from starlette.requests import Request


def test_eight_connections_claim_once_and_old_owner_cannot_release(engine):
    now = datetime.utcnow()
    barrier = Barrier(8)

    def claim(_):
        with Session(engine) as session:
            barrier.wait(timeout=15)
            return work_claims.acquire(session, "pg-claim", now, seconds=1)

    with ThreadPoolExecutor(max_workers=8) as pool:
        tokens = list(pool.map(claim, range(8)))
    winners = [token for token in tokens if token]
    assert len(winners) == 1
    with Session(engine) as session:
        successor = work_claims.acquire(session, "pg-claim", now + timedelta(seconds=2))
        assert successor and successor != winners[0]
        work_claims.release(session, "pg-claim", winners[0])
        assert work_claims.acquire(session, "pg-claim", now + timedelta(seconds=3)) is None


def test_eight_webhook_workers_commit_one_receipt_and_retries_are_safe(engine, stripe_gateway):
    with Session(engine) as session:
        user = User(clerk_user_id="pg-buyer", email="pg@example.test", full_name="Buyer")
        session.add(user)
        session.commit()
        user_id = user.id
    body = json.dumps(stripe_gateway.bind(engine, user_id)).encode()
    timestamp = str(int(time.time()))
    digest = hmac.new(SECRET.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()
    barrier = Barrier(8)

    def deliver(wait=True):
        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}

        request = Request({"type": "http", "headers": [
            (b"stripe-signature", f"t={timestamp},v1={digest}".encode()),
        ]}, receive)
        with Session(engine) as session:
            if wait:
                barrier.wait(timeout=15)
            try:
                return asyncio.run(webhook(request, session))
            except HTTPException as error:
                assert error.status_code == 503
                return {"busy": True}

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: deliver(), range(8)))
    assert sum(not result.get("duplicate") and not result.get("busy") for result in results) == 1
    assert deliver(wait=False)["duplicate"] is True
    with Session(engine) as session:
        assert session.exec(select(BillingEvent)).one().status == "processed"
        assert session.get(User, user_id).plan == "premium"
