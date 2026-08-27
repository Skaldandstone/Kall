# Wiring Stripe

Everything except payment is built. The quota service enforces the tiers, the
paywall appears when someone hits one, and the support console can move an
account between plans by hand. What is missing is the ability for a user to buy
a plan themselves.

Right now `POST /api/billing/checkout` returns **503** when a price is not
configured, and the plan picker turns that into "Payments are not switched on
yet. Nothing has been charged." That is deliberate - a dead button that appears
to work is worse than one that admits it is not ready.

## What already exists

| Piece | Where |
| --- | --- |
| Plan limits and enforcement | `backend/kall/services/quota.py` |
| Checkout session creation | `backend/kall/services/billing.py`, `create_checkout_url(user_id, plan)` |
| Price lookup per plan | `billing.price_for(plan)` |
| Webhook handler | `backend/kall/api_billing.py`, `apply_subscription_event` |
| Customer portal | `create_portal_url(customer_id)` |
| Plan picker UI | `apps/web/app/billing/PlanPicker.tsx` |
| Paywall | `apps/web/app/components/PlanLimitDialog.tsx` |

`SubscriptionPlan` already has `FREE`, `PLUS` and `PREMIUM`, and
`config.Settings` already reads `stripe_price_id` (Plus) and
`stripe_premium_price_id`.

## Steps

### 1. Create two recurring prices in Stripe

Test mode first. Two products, or one product with two prices - either works,
the code only cares about the price ids.

| Plan | Price | Interval |
| --- | --- | --- |
| Kall Plus | $5.00 USD | monthly |
| Kall Premium | $15.00 USD | monthly |

Copy both `price_...` ids.

### 2. Set four environment variables

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_ID=price_...            # Plus
STRIPE_PREMIUM_PRICE_ID=price_...    # Premium
STRIPE_WEBHOOK_SECRET=whsec_...      # from step 3
```

In production these belong in Secrets Manager as `kall/*` entries, referenced
from the `kall-api` task definition's `secrets` block - the same pattern as
`kall/clerk-secret-key`. See `docs/AWS_DEPLOYMENT.md`.

The web service does **not** need any of these. Checkout is created by the API.

### 3. Create the webhook destination

Point it at:

```
https://<api-host>/api/billing/webhook
```

Enable at least:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Copy the signing secret into `STRIPE_WEBHOOK_SECRET` and restart the API.

Locally, `stripe listen --forward-to localhost:8000/api/billing/webhook` gives
you a `whsec_` for development without exposing anything.

### 4. Nothing - the plan mapping is already done

Noted here because it is the part that looks like it still needs work.
`create_checkout_url` puts `kall_plan` in both the session metadata and
`subscription_data.metadata`; `plan_from_event` reads it, falls back to
matching the price id against `price_for`, and refuses to grant Premium from
an unrecognised value. `apply_subscription_event` then writes the plan to
**both** `Subscription.plan` and `User.plan`.

That last part matters: the quota service reads `User.plan`. Until this was
fixed the handler hardcoded `"plus"` and never touched the account, so a
completed purchase updated the billing record while the limits stayed on Free.
`tests/test_billing_plan_mapping.py` pins both halves down.

### 5. Verify before trusting it

1. Sign up a fresh account and confirm it starts on Free with a weekly allowance.
2. Buy Plus with test card `4242 4242 4242 4242`.
3. Confirm the account's plan changes, and that `GET /api/me/usage` reports the
   Plus limits rather than Free.
4. Confirm the webhook delivery returned 2xx and that redelivering the same
   event does not double-apply - `BillingEvent.provider_event_id` is unique,
   which is what makes the handler idempotent.
5. Cancel through the customer portal and confirm the account returns to Free
   at period end rather than immediately.
6. Exhaust the Plus weekly allowance and confirm the paywall offers Premium
   rather than Plus.

Do not switch to live keys until all six pass.

## Things worth getting right

- **Downgrades must not delete anything.** Someone dropping to Free keeps every
  resume and application; they simply cannot add more until the week turns. The
  quota service already behaves this way because storage is a gauge, but it is
  worth confirming against a real cancellation.
- **The usage counter is not the subscription.** A plan change takes effect
  immediately for limits, and the counters are keyed by period rather than by
  subscription, so mid-week upgrades do not reset anyone's usage. That is
  intentional: upgrading raises the ceiling, it does not hand out a fresh
  allowance.
- **Exempt accounts must ignore Stripe entirely.** `billing_exempt` short
  circuits every quota check regardless of plan, so a development account with
  no subscription is unaffected by any of this.
- **Test the failure path.** `invoice.payment_failed` should not instantly lock
  someone out mid-search. Decide what the grace period is before going live;
  nothing implements one today.

## Prices live in two places

Stripe holds the real price. `apps/web/app/lib/plans.ts` holds the copy shown to
users. They are duplicated deliberately so a paywall renders instantly at the
moment someone is blocked, rather than waiting on a network call - but that
means **changing a price means changing both**, and the Stripe one is the one
that charges.
