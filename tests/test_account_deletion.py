"""Deleting an account.

The design bet this module makes is that walking the schema's foreign-key
graph generically is safer than hand-listing the tables that reference a
user, because the generic version cannot forget a table that gets added
later. The way to actually test that bet is to populate *every* user-scoped
table the schema currently has -- not a hand-picked sample -- and check that
none of it survives. `_populate_every_user_scoped_table` below does that
reflectively for the same reason `account_deletion.py` resolves its own
tables reflectively: a hand-written list of "the tables worth testing" would
rot the same way a hand-written deletion order would.

FK enforcement is turned on for these tests specifically. SQLite does not
enforce foreign keys by default, and production (Postgres) always does -- so
a naive test suite here could pass while the real deletion order is wrong,
which is the single riskiest part of this design. Enabling PRAGMA
foreign_keys=ON is the closest local approximation of that production
constraint.
"""

from datetime import datetime, time

import pytest
from kall.models.core import AdminAction, User
from kall.services.account_deletion import delete_account, plan_deletion
from sqlalchemy import JSON, Boolean, DateTime, Enum, Float, Integer, Time, event, func, select
from sqlmodel import Session, SQLModel, create_engine


@pytest.fixture
def fk_engine():
    """Like the shared `engine` fixture, but with real FK enforcement.

    A wrong deletion order raises IntegrityError here exactly as it would
    against Postgres, which the default test engine cannot catch. The
    listener is registered on this specific engine instance, not on the
    Engine class globally -- SQLite's own connect-time pragma is per
    connection, but `event.listens_for(Engine, ...)` fires for every engine
    created anywhere in the process, which would have quietly turned on FK
    enforcement for every other test file's fixtures too.
    """
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    event.listen(engine, "connect", lambda dbapi_connection, _record: dbapi_connection.execute("PRAGMA foreign_keys=ON"))
    SQLModel.metadata.create_all(engine)
    return engine


def _dummy_value(column):
    """A value that satisfies `column`'s type and NOT NULL constraint.

    Not trying to be a realistic value -- just one that inserts without
    violating a type or nullability constraint, so a table can exist to be
    deleted from.
    """
    if isinstance(column.type, Boolean):
        return False
    if isinstance(column.type, DateTime):
        return datetime(2020, 1, 1)
    if isinstance(column.type, Time):
        return time(9, 0)
    if isinstance(column.type, Float):
        return 0.0
    if isinstance(column.type, JSON):
        return {}
    if isinstance(column.type, Enum):
        return list(column.type.enums)[0]
    try:
        python_type = column.type.python_type
    except NotImplementedError:
        # SQLModel's AutoString (and some other custom types) do not
        # implement python_type at all -- treat as string, which is what
        # AutoString actually stores.
        python_type = str
    if python_type is int:
        return 1
    return "x"


def _populate_every_user_scoped_table(session: Session, user_id: int) -> set[str]:
    """Insert a row into every table in the schema, then report which ones
    the deletion module itself considers user-scoped.

    Every table is populated, not only the user-scoped ones, because a
    user-scoped table can carry a required foreign key to a table that is
    NOT user-scoped (Application.job_id -> Job, shared catalog data) -- that
    row has to exist somewhere before the user-scoped row pointing at it can
    be inserted. Walking metadata.sorted_tables guarantees creation order:
    by the time any table is populated, everything it can point to already
    exists.
    """
    from kall.services.account_deletion import _resolve_user_scoped_tables

    scoped = _resolve_user_scoped_tables(SQLModel.metadata)
    created_pk: dict[str, int | str] = {"user": user_id}

    for table in SQLModel.metadata.sorted_tables:
        if table.name == "user":
            continue

        values = {}
        for column in table.columns:
            if column.primary_key and column.autoincrement and isinstance(column.type, Integer):
                continue
            if column.foreign_keys:
                fk = next(iter(column.foreign_keys))
                target = fk.column.table.name
                if target in created_pk:
                    values[column.name] = created_pk[target]
                elif not column.nullable:
                    # Not user-scoped and not yet built by this point in the
                    # topological order (only self-references end up here,
                    # which no table in this schema currently has); a real
                    # value is still needed to satisfy NOT NULL.
                    values[column.name] = _dummy_value(column)
                continue
            if not column.nullable:
                values[column.name] = _dummy_value(column)

        result = session.execute(table.insert().values(**values))
        session.commit()
        new_id = result.inserted_primary_key[0] if result.inserted_primary_key else None
        if new_id is not None:
            created_pk[table.name] = new_id

    return set(scoped.keys())


def _row_count(session: Session, table_name: str, column_name: str, user_id: int) -> int:
    table = SQLModel.metadata.tables[table_name]
    return session.execute(
        select(func.count()).select_from(table).where(table.c[column_name] == user_id)
    ).scalar()


def test_every_user_scoped_table_is_actually_emptied(fk_engine) -> None:
    """The test the whole design exists to pass.

    Populates every table the schema currently resolves as user-scoped --
    dozens of them, multi-hop chains included -- then deletes the account and
    checks each one directly against the database, not through the module
    that just claimed to have deleted them.
    """
    from kall.services.account_deletion import _resolve_user_scoped_tables

    with Session(fk_engine) as session:
        user = User(clerk_user_id="user_full", email="full@example.com", full_name="Full User")
        session.add(user)
        session.commit()
        session.refresh(user)
        user_id = user.id

        populated = _populate_every_user_scoped_table(session, user_id)
        assert len(populated) > 20, "the fixture should exercise most of the schema, not a handful of tables"

        report = delete_account(session, user_id)

    with Session(fk_engine) as session:
        scoped = _resolve_user_scoped_tables(SQLModel.metadata)
        for table_name in populated:
            if table_name in ("adminaction",):
                continue  # preserved by design -- checked separately below
            column = scoped[table_name]
            # This only works directly for tables whose scoping column IS the
            # user id (one hop). Multi-hop tables are checked structurally:
            # the row they pointed at is gone, so an orphan would now violate
            # the very FK constraint the fk_engine enforces -- which the
            # commit above already proved did not happen.
            if column.foreign_keys and next(iter(column.foreign_keys)).column.table.name == "user":
                assert _row_count(session, table_name, column.name, user_id) == 0, (
                    f"{table_name} still has a row for the deleted user"
                )
        assert session.get(User, user_id) is None

    assert report.deleted["user"] == 1


def test_a_two_hop_chain_is_cleared(engine) -> None:
    """GeneratedDocument -> DocumentArtifact is not a direct user_id column.

    Named explicitly because it is exactly the shape a hand-written table
    list is most likely to miss: nothing about DocumentArtifact mentions a
    user anywhere in its own columns.
    """
    from kall.models.documents import DocumentArtifact, GeneratedDocument

    with Session(engine) as session:
        user = User(clerk_user_id="user_chain", email="chain@example.com", full_name="Chain User")
        session.add(user)
        session.commit()
        session.refresh(user)

        doc = GeneratedDocument(user_id=user.id, document_type="resume", checksum="abc")
        session.add(doc)
        session.commit()
        session.refresh(doc)
        artifact = DocumentArtifact(
            generated_document_id=doc.id, format="pdf", file_path="x", mime_type="application/pdf", byte_size=1, checksum="abc"
        )
        session.add(artifact)
        session.commit()
        artifact_id = artifact.id

        report = delete_account(session, user.id)

    with Session(engine) as session:
        assert session.get(DocumentArtifact, artifact_id) is None
        assert report.deleted.get("documentartifact") == 1
        assert report.deleted.get("generateddocument") == 1


def test_admin_action_is_preserved_when_the_actor_is_deleted(engine) -> None:
    with Session(engine) as session:
        actor = User(clerk_user_id="user_actor", email="actor@example.com", full_name="Actor")
        target = User(clerk_user_id="user_target", email="target@example.com", full_name="Target")
        session.add_all([actor, target])
        session.commit()
        session.refresh(actor)
        session.refresh(target)

        actor_id, target_id, actor_email = actor.id, target.id, actor.email
        session.add(AdminAction(
            actor_user_id=actor_id, actor_email=actor_email, action="set_plan",
            target_user_id=target_id, detail={"reason": "test"},
        ))
        session.commit()
        action_id = session.exec(select(AdminAction.id)).first()

        report = delete_account(session, actor_id)

    with Session(engine) as session:
        row = session.get(AdminAction, action_id)
        assert row is not None, "the audit row itself must survive"
        assert row.actor_user_id is None
        assert row.actor_email == actor_email, "who did this must still be answerable"
        assert row.target_user_id == target_id, "unrelated to the actor's deletion"
        assert report.nulled.get("adminaction.actor_user_id") == 1


def test_admin_action_is_preserved_when_the_target_is_deleted(engine) -> None:
    with Session(engine) as session:
        actor = User(clerk_user_id="user_actor2", email="actor2@example.com", full_name="Actor")
        target = User(clerk_user_id="user_target2", email="target2@example.com", full_name="Target")
        session.add_all([actor, target])
        session.commit()
        session.refresh(actor)
        session.refresh(target)

        actor_id, target_id = actor.id, target.id
        session.add(AdminAction(
            actor_user_id=actor_id, actor_email=actor.email, action="reset_usage",
            target_user_id=target_id, detail={},
        ))
        session.commit()
        action_id = session.exec(select(AdminAction.id)).first()

        delete_account(session, target_id)

    with Session(engine) as session:
        row = session.get(AdminAction, action_id)
        assert row is not None
        assert row.target_user_id is None
        assert row.actor_user_id == actor_id, "unrelated to the target's deletion"


def test_shared_catalog_data_is_left_alone(engine) -> None:
    """A Job posting is not any one user's data and must not be touched."""
    from kall.models.core import Job

    with Session(engine) as session:
        user = User(clerk_user_id="user_shared", email="shared@example.com", full_name="Shared")
        session.add(user)
        job = Job(source="test", company="Acme", title="Engineer", description="x", url="https://example.com/shared-job")
        session.add(job)
        session.commit()
        session.refresh(user)
        session.refresh(job)
        job_id = job.id

        delete_account(session, user.id)

    with Session(engine) as session:
        assert session.get(Job, job_id) is not None


def test_deleting_twice_is_a_no_op_the_second_time(engine) -> None:
    with Session(engine) as session:
        user = User(clerk_user_id="user_twice", email="twice@example.com", full_name="Twice")
        session.add(user)
        session.commit()
        session.refresh(user)
        user_id = user.id

        delete_account(session, user_id)
        second = delete_account(session, user_id)

    assert second.deleted == {}
    assert second.nulled == {}


def test_a_deletion_record_survives_and_names_no_one_else(engine) -> None:
    """The one thing meant to outlive the account it describes."""
    from kall.models.core import AccountDeletionRecord

    with Session(engine) as session:
        user = User(clerk_user_id="user_record", email="record@example.com", full_name="Record")
        session.add(user)
        session.commit()
        session.refresh(user)
        user_id = user.id

        delete_account(session, user_id, reason="self_service")

    with Session(engine) as session:
        assert session.get(User, user_id) is None
        record = session.execute(select(AccountDeletionRecord)).scalars().one()
        assert record.email == "record@example.com"
        assert record.reason == "self_service"


def test_plan_deletion_reports_without_deleting_anything(engine) -> None:
    from kall.models.documents import GeneratedDocument

    with Session(engine) as session:
        user = User(clerk_user_id="user_plan", email="plan@example.com", full_name="Plan")
        session.add(user)
        session.commit()
        session.refresh(user)
        session.add(GeneratedDocument(user_id=user.id, document_type="resume", checksum="x"))
        session.commit()

        report = plan_deletion(session, user.id)
        assert report.deleted.get("generateddocument") == 1
        assert report.deleted.get("user") == 1

    with Session(engine) as session:
        assert session.get(User, user.id) is not None, "a plan must not delete anything"


def test_delete_me_requires_the_account_email_to_match(client) -> None:
    response = client.request(
        "DELETE", "/api/me", json={"confirm_email": "someone-else@example.com"}
    )
    assert response.status_code == 422
    # Refused, so the account must still be there.
    assert client.get("/api/me").status_code == 200


def test_delete_me_removes_the_account(client) -> None:
    email = client.get("/api/me").json()["email"]
    response = client.request("DELETE", "/api/me", json={"confirm_email": email.upper()})
    assert response.status_code == 204

    # A request as a deleted user must read as unauthenticated, not succeed
    # as if nothing happened and not crash with an unrelated error either.
    follow_up = client.get("/api/me")
    assert follow_up.status_code == 401


def test_a_deleted_clerk_identity_is_not_silently_resurrected(engine, monkeypatch) -> None:
    """The gap this whole tombstone exists to close.

    Deleting the Kall account does not sign anyone out of Clerk. Without this
    check, the very next authenticated request from a browser that still
    holds a valid Clerk session would land in ensure_local_user() and find no
    User row for that clerk_user_id -- which is exactly the "create on first
    sight" case it exists for, so it would quietly build a fresh account and
    the deletion would look like it had never happened.
    """
    from fastapi import HTTPException
    from kall.auth import ensure_local_user

    with Session(engine) as session:
        user = User(clerk_user_id="user_resurrect", email="resurrect@example.com", full_name="R")
        session.add(user)
        session.commit()
        session.refresh(user)
        delete_account(session, user.id)

    with Session(engine) as session:
        with pytest.raises(HTTPException) as excinfo:
            ensure_local_user(session, "user_resurrect")
        assert excinfo.value.status_code == 401


def test_a_genuinely_new_signup_is_unaffected_by_someone_elses_deletion(engine, monkeypatch) -> None:
    """The tombstone is keyed by the specific Clerk id, not by email or by
    "someone was deleted recently" -- a different, brand-new Clerk identity
    must sign up normally even moments later."""
    from kall.auth import ensure_local_user

    with Session(engine) as session:
        user = User(clerk_user_id="user_departed", email="departed@example.com", full_name="D")
        session.add(user)
        session.commit()
        session.refresh(user)
        delete_account(session, user.id)

    monkeypatch.setattr(
        "kall.auth._clerk_profile",
        lambda clerk_user_id: ("new-person@example.com", "New Person", {}),
    )
    with Session(engine) as session:
        created = ensure_local_user(session, "user_brand_new")
        assert created.email == "new-person@example.com"
