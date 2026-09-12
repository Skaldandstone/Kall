"""POST /me/search-sources accepts exactly the providers services/discovery.py
actually knows how to run -- the two must never drift apart, which is why
the endpoint checks against PROVIDERS directly rather than its own list."""


def test_every_registered_provider_is_accepted(client) -> None:
    from kall.services.discovery import PROVIDERS

    for provider in PROVIDERS:
        response = client.post("/api/me/search-sources", json={
            "provider": provider, "company_name": "Acme", "board_key": "acme", "enabled": True,
        })
        assert response.status_code == 200, response.text
        assert response.json()["provider"] == provider


def test_workday_is_registered_and_accepted(client) -> None:
    """Regression test: Workday reaches a large share of retail, healthcare,
    and hospitality employers that Greenhouse/Lever/Ashby (startup/tech
    oriented) never reach -- added so the discovery pipeline isn't
    exclusively a software-job pipeline."""
    response = client.post("/api/me/search-sources", json={
        "provider": "workday", "company_name": "Acme Retail",
        "board_key": "acme.wd5.myworkdayjobs.com/External", "enabled": True,
    })
    assert response.status_code == 200, response.text
    assert response.json()["board_key"] == "acme.wd5.myworkdayjobs.com/External"


def test_an_unregistered_provider_is_rejected(client) -> None:
    response = client.post("/api/me/search-sources", json={
        "provider": "workable", "company_name": "Acme", "board_key": "acme", "enabled": True,
    })
    assert response.status_code == 422
