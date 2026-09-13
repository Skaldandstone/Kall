"""Synthetic Stripe state. No credentials, real customers, or network calls."""

import hashlib
import hmac
import json
import time
from copy import deepcopy
from types import SimpleNamespace

from kall.clock import utcnow
from kall.models import Subscription
from sqlmodel import Session

SECRET = "whsec_local_test_only"
SCOPE = "kall:local-security-test"


def delivery(client, event, *, timestamp=None, body=None):
    body = body if body is not None else json.dumps(event)
    timestamp = str(int(time.time()) if timestamp is None else timestamp)
    digest = hmac.new(SECRET.encode(), f"{timestamp}.{body}".encode(), hashlib.sha256).hexdigest()
    return client.post("/api/billing/webhook", content=body,
                       headers={"stripe-signature": f"t={timestamp},v1={digest}"})


def price(plan="premium", *, livemode=False):
    return {"id": f"price_{plan}", "product": f"prod_kall_{plan}", "livemode": livemode,
            "active": True, "recurring": {"interval": "month", "interval_count": 1}}


class FakeStripe:
    def __init__(self, *, livemode=False):
        self.livemode = livemode
        self.customers, self.subscriptions, self.checkouts = {}, {}, {}
        self.customer_keys, self.checkout_keys, self.calls = {}, {}, []
        self.charges, self.refunds, self.refund_keys = {}, {}, {}
        self.prices = {f"price_{plan}": price(plan, livemode=livemode) for plan in ("plus", "premium")}
        self.configuration = {"id": "bpc_kall", "active": True, "livemode": livemode,
                              "features": {"subscription_update": {"enabled": True, "products": [
                                  {"product": f"prod_kall_{plan}", "prices": [f"price_{plan}"]}
                                  for plan in ("plus", "premium")
                              ]}}}
        self.v1 = SimpleNamespace(
            customers=SimpleNamespace(create=self.create_customer, retrieve=self.retrieve_customer),
            prices=SimpleNamespace(retrieve=lambda key: deepcopy(self.prices[key])),
            subscriptions=SimpleNamespace(retrieve=self.retrieve_subscription,
                                          update=self.update_subscription),
            checkout=SimpleNamespace(sessions=SimpleNamespace(create=self.create_checkout,
                                      retrieve=lambda key: deepcopy(self.checkouts[key]))),
            billing_portal=SimpleNamespace(
                configurations=SimpleNamespace(retrieve=self.retrieve_portal_configuration),
                sessions=SimpleNamespace(create=self.create_portal)),
            charges=SimpleNamespace(list=self.list_charges, retrieve=self.retrieve_charge),
            refunds=SimpleNamespace(create=self.create_refund),
        )

    def charge(self, customer_id, *, charge_id="ch_local_1", amount=1500, status="succeeded", refunded=False):
        self.charges[charge_id] = {"id": charge_id, "object": "charge", "customer": customer_id, "amount": amount,
                                   "amount_refunded": amount if refunded else 0, "currency": "usd",
                                   "status": status, "refunded": refunded, "created": 1800000000,
                                   "description": "Kall Premium", "invoice": f"in_{charge_id}",
                                   "receipt_url": f"https://pay.stripe.com/receipts/{charge_id}"}
        return charge_id

    def list_charges(self, params):
        self.calls.append(("charge.list", deepcopy(params)))
        rows = [deepcopy(c) for c in self.charges.values() if c["customer"] == params.get("customer")]
        return {"object": "list", "data": rows[: params.get("limit", 10)]}

    def retrieve_charge(self, key):
        self.calls.append(("charge.retrieve", key))
        return deepcopy(self.charges[key])

    def create_refund(self, params, options):
        self.calls.append(("refund.create", deepcopy(params), options))
        key = options["idempotency_key"]
        if key not in self.refund_keys:
            charge = self.charges[params["charge"]]
            refund_id = f"re_local_{len(self.refunds) + 1}"
            self.refunds[refund_id] = {"id": refund_id, "object": "refund", "charge": charge["id"],
                                       "amount": charge["amount"], "status": "succeeded"}
            charge["refunded"], charge["amount_refunded"] = True, charge["amount"]
            self.refund_keys[key] = refund_id
        return deepcopy(self.refunds[self.refund_keys[key]])

    def create_customer(self, params, options):
        self.calls.append(("customer.create", deepcopy(params), options))
        key = options["idempotency_key"]
        if key not in self.customer_keys:
            customer_id = f"cus_local_{len(self.customers) + 1}"
            self.customers[customer_id] = {"id": customer_id, "livemode": self.livemode, **deepcopy(params)}
            self.customer_keys[key] = customer_id
        return deepcopy(self.customers[self.customer_keys[key]])

    def retrieve_customer(self, key):
        self.calls.append(("customer.retrieve", key))
        return deepcopy(self.customers[key])

    def retrieve_subscription(self, key, params=None):
        self.calls.append(("subscription.retrieve", key, params))
        return deepcopy(self.subscriptions[key])

    def update_subscription(self, key, params, options=None):
        self.calls.append(("subscription.update", key, deepcopy(params), options))
        self.subscriptions[key].update(deepcopy(params))
        return deepcopy(self.subscriptions[key])

    def create_checkout(self, params, options):
        self.calls.append(("checkout.create", deepcopy(params), options))
        key = options["idempotency_key"]
        if key not in self.checkout_keys:
            mode = "live" if self.livemode else "test"
            session_id = f"cs_{mode}_local_{len(self.checkouts) + 1}"
            self.checkouts[session_id] = {"id": session_id, "livemode": self.livemode, "status": "open",
                                        "url": f"https://checkout.stripe.com/c/pay/{session_id}",
                                        **deepcopy(params)}
            self.checkout_keys[key] = session_id
        return deepcopy(self.checkouts[self.checkout_keys[key]])

    def create_portal(self, params):
        self.calls.append(("portal.create", deepcopy(params)))
        return {"url": "https://billing.stripe.com/p/session/local"}

    def retrieve_portal_configuration(self, key, params=None):
        self.calls.append(("portal.configuration.retrieve", key, deepcopy(params)))
        return deepcopy(self.configuration)

    def bind(self, engine, user_id, *, plan="premium", status="active", suffix="local"):
        customer_id, subscription_id = f"cus_{suffix}", f"sub_{suffix}"
        metadata = {"kall_user_id": str(user_id), "kall_billing_scope": SCOPE, "kall_binding": f"binding_{suffix}"}
        self.customers[customer_id] = {"id": customer_id, "livemode": self.livemode, "metadata": metadata}
        obj = {"id": subscription_id, "object": "subscription", "livemode": self.livemode,
               "customer": customer_id, "status": status, "metadata": metadata,
               "items": {"has_more": False, "data": [{"id": f"si_{suffix}", "quantity": 1,
                         "price": price(plan, livemode=self.livemode), "current_period_end": 1900000000}]},
               "latest_invoice": {"id": f"in_{suffix}", "status": "paid"}}
        self.subscriptions[subscription_id] = obj
        with Session(engine) as session:
            session.add(Subscription(user_id=user_id, provider_customer_id=customer_id,
                                     billing_scope=SCOPE, provider_livemode=self.livemode,
                                     billing_binding_key=f"binding_{suffix}", billing_binding_created_at=utcnow()))
            session.commit()
        return self.event(subscription_id)

    def event(self, subscription_id="sub_local", *, event_id="evt_retry", event_type="customer.subscription.created"):
        return {"id": event_id, "object": "event", "livemode": self.livemode, "type": event_type,
                "data": {"object": deepcopy(self.subscriptions[subscription_id])}}

    def invoice(self, *, event_id="evt_invoice", event_type="invoice.payment_failed", subscription_id="sub_local", invoice_id="in_local"):
        return {"id": event_id, "object": "event", "livemode": self.livemode, "type": event_type,
                "data": {"object": {"id": invoice_id, "customer": self.subscriptions[subscription_id]["customer"],
                         "parent": {"subscription_details": {"subscription": subscription_id}},
                         "customer_address": {"line1": "Never persist this private address"}}}}
