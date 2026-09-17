from kall.models import User
from kall.services.support_id import generate_support_id
from sqlmodel import Session


def test_generate_support_id_is_eight_digits(engine) -> None:
    with Session(engine) as session:
        support_id = generate_support_id(session)
    assert len(support_id) == 8
    assert support_id.isdigit()


def test_generate_support_id_avoids_an_existing_collision(engine, monkeypatch) -> None:
    """A candidate matching an existing row must be retried, not returned."""
    with Session(engine) as session:
        taken = User(clerk_user_id="taken", email="taken@example.com", full_name="Taken", support_id="12345678")
        session.add(taken)
        session.commit()

        calls = iter(["12345678", "87654321"])
        monkeypatch.setattr("kall.services.support_id.secrets.randbelow", lambda _n: int(next(calls)))

        assert generate_support_id(session) == "87654321"
