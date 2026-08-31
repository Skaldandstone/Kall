"""Opt-in real PostgreSQL fixtures, isolated from the default test suite."""

import importlib.util
import os
import sys
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.schema import CreateSchema
from sqlmodel import SQLModel, create_engine

TESTS = Path(__file__).resolve().parents[2] / "tests"
sys.path.insert(0, str(TESTS))
spec = importlib.util.spec_from_file_location("kall_base_test_fixtures", TESTS / "conftest.py")
base_fixtures = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base_fixtures
spec.loader.exec_module(base_fixtures)
pytest_plugins = ["kall_base_test_fixtures"]


@pytest.fixture
def engine():
    raw = os.environ.get("KALL_VALIDATION_DATABASE_URL")
    if not raw:
        pytest.fail("Run scripts/validate_postgres.py against its owned local test cluster")
    url = make_url(raw)
    if url.host != "127.0.0.1" or url.port != 55437 or not url.database.startswith("kall_validation_"):
        pytest.fail("Refusing a non-validation PostgreSQL destination")
    admin = create_engine(url)
    schema = "kall_case_" + uuid4().hex
    with admin.begin() as connection:
        connection.execute(CreateSchema(schema))
    case = create_engine(url, connect_args={"options": f"-csearch_path={schema}"}, pool_size=10, max_overflow=10)
    with case.connect() as connection:
        assert connection.execute(text("SELECT current_schema()")).scalar_one() == schema
    SQLModel.metadata.create_all(case)
    try:
        yield case
    finally:
        # Preserve synthetic evidence until the isolated cluster is stopped.
        # No pre-existing database/schema is dropped or reset by these tests.
        case.dispose()
        admin.dispose()
