import pytest
from kall.rate_limit import limiter


@pytest.fixture(autouse=True)
def _reset_rate_limiter() -> None:
    # The limiter is a process-wide singleton keyed by remote address, and
    # TestClient's address is constant across every test in the same pytest
    # process -- without this, whichever test happens to exhaust a limit
    # first "poisons" every later test that hits the same endpoint.
    limiter.reset()
