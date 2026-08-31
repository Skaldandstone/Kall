"""Read-only Stripe sandbox readiness check without printing credentials."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request


def get(path: str) -> tuple[int, dict]:
    request = urllib.request.Request(
        "https://api.stripe.com" + path,
        headers={"Authorization": "Bearer " + os.environ["STRIPE_SECRET_KEY"]},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, {}


def main() -> None:
    results: dict[str, object] = {}
    resources = {
        "plus_price": "/v1/prices/price_1UAZVXPo4uRuCWxjmqORD3B1",
        "premium_price": "/v1/prices/price_1UAZWAPo4uRuCWxjhgrbIixK",
        "portal": "/v1/billing_portal/configurations/bpc_1UAZuwPo4uRuCWxjhHqUOhyN",
    }
    for name, path in resources.items():
        status, body = get(path)
        results[name] = {
            "status": status,
            "id": body.get("id"),
            "active": body.get("active"),
            "livemode": body.get("livemode"),
        }

    status, body = get("/v1/webhook_endpoints?limit=100")
    results["webhooks"] = {
        "status": status,
        "items": [
            {
                "id": row.get("id"),
                "url": row.get("url"),
                "status": row.get("status"),
                "livemode": row.get("livemode"),
                "events": row.get("enabled_events", []),
            }
            for row in body.get("data", [])
        ],
    }
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
