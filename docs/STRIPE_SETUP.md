# Kall Stripe sandbox integration

Status: implemented locally and sandbox catalog configured; payments default off
and live keys are refused. Provider receipts from the Stripe owner establish the
Kall sandbox offers, restricted key, Accounts Read verification and explicit
portal configuration. The connector still needs reauthentication, but that does
not invalidate the completed provider setup. No runtime secret injection,
webhook destination, tax registration or application payment flow exists yet.

## Existing commercial model

Free, Plus and Premium, quotas, billing exemptions and the 72-hour payment
failure grace period remain unchanged. Existing copy in
`apps/web/app/lib/plans.ts` shows Plus at $5/month and Premium at $15/month.
The sandbox now contains Kall Plus at USD 5/month and Premium at USD 15/month:

- Plus: `price_1UAZVXPo4uRuCWxjmqORD3B1`, product `prod_VAvMNUYFhL2Kit`
- Premium: `price_1UAZWAPo4uRuCWxjhgrbIixK`, product `prod_VAvMM3BYCN82Ul`
- Kall portal: `bpc_1UAZuwPo4uRuCWxjhHqUOhyN`

The nonsecret disabled configuration is checked in at
`deploy/kall-development.env.example`. It does not change the business model.

## Server contract

- Clerk-authenticated `POST /api/billing/checkout` accepts only
  `{"plan":"plus"}` or `{"plan":"premium"}`. Price, customer, user, subscription
  metadata and redirect URLs cannot be supplied by the browser.
- Authenticated `POST /api/billing/portal` retrieves and verifies the user's
  dedicated Kall customer and explicit portal configuration.
- Authenticated `GET /api/billing/status` exposes availability and whether
  management is possible, never provider IDs or binding tokens.
- `GET /api/me/usage` remains the entitlement display. `/billing` is the
  existing **signed-in web page**, not a public pricing endpoint. Studio should
  retain its existing product root link until a public destination is agreed.
- `POST /api/billing/webhook` verifies the exact raw body with Stripe's SDK,
  limits it to 512 KiB, rejects live/Connect events and unknown customers, and
  handles subscription created/updated/deleted plus invoice paid/payment failed.
  Checkout return is informational and cannot grant access.

The server creates a dedicated Customer using a persisted random binding and a
Kall/environment scope. Every customer and subscription must carry matching
`kall_user_id`, `kall_billing_scope` and `kall_binding` metadata and test mode.
An event's metadata alone cannot attach a Customer to a user. Actual current
subscription Price/Product pairs determine entitlements; missing, foreign,
mixed or ambiguous items grant Free. Informational `kall_plan` is not trusted.
Only one quantity-one recurring item is supported.

A shared Stripe business does not imply shared customers or entitlements.
Never reuse another product's customer binding or portal catalog. Separate
restricted keys alone do not isolate objects within one Stripe business.

## Configuration, with no real secrets in source

Both tier pairs and the signing secret must exist before the opt-in gate opens:

```dotenv
STRIPE_ENABLED=false
STRIPE_LIVEMODE=false
STRIPE_BILLING_SCOPE=kall:<unique-environment-name>
STRIPE_SECRET_KEY=<restricted-test-key-from-vault>
STRIPE_WEBHOOK_SECRET=<destination-signing-secret-from-vault>
STRIPE_PRICE_ID=<approved-plus-recurring-price-id>
STRIPE_PLUS_PRODUCT_ID=<approved-plus-product-id>
STRIPE_PREMIUM_PRICE_ID=<approved-premium-recurring-price-id>
STRIPE_PREMIUM_PRODUCT_ID=<approved-premium-product-id>
STRIPE_PORTAL_CONFIGURATION_ID=<kall-only-portal-configuration-id>
FRONTEND_URL=<verified-web-origin>
```

Use a restricted test key with the necessary Customer, Checkout Session and
portal-session write permissions and Price, subscription, invoice and portal
configuration read permissions. Confirm exact permission names and sandbox
identity in Stripe before setup. The API alone needs keys; the web client does
not. Supply secrets through the existing vault/runtime injection mechanism,
never command arguments, source, screenshots, reports or chat.

The shared development foundation and `dev/kall/stripe` record already exist in
AWS project `734702670689`. They do not constitute a Kall runtime. Do not
conflate this foundation with Kall's historical deployment. Regional work stays
in the selected Region `us-east-2`.

Require a Kall-specific portal configuration. Its optional subscription-update
catalog is checked against the same Price/Product allowlist. Prefer cancellation
at period end; confirm portal features and the real hosted UX before release.
Do not use the business-wide default portal configuration.

## Reliability and migration

SDK `stripe==15.6.0` uses an instance-scoped `StripeClient` pinned to
`2026-08-26.dahlia`, 10-second HTTP timeouts and one SDK retry. Raw webhook
verification uses the current SDK's recursive `to_dict()` conversion.
Subscription periods come from subscription items. Modern invoice
`parent.subscription_details.subscription` and the legacy pointer are accepted.

Current subscriptions are retrieved during reconciliation instead of sorting by
event timestamps. An invoice must be the owned subscription's current invoice.
Old subscription events cannot replace a newer active binding. Event receipts
and both entitlement records commit atomically; failed processing stays retryable.
Receipts contain only reconciliation references, not invoice addresses or full
provider payloads.

User-scoped expiring database leases serialize Checkout, portal and webhook work.
A conditional fencing write prevents an expired owner from committing. Customer
and Checkout idempotency keys are persisted before external creation, so an
ambiguous timeout retries the same operation. Open Checkout sessions are reused;
a plan change cannot create a competing open purchase. Existing active
subscriptions go through the portal. A completed Checkout only permits a new
purchase after its bound subscription is terminal. Unresolved creation past the
safe retry window requires owner reconciliation, not blind re-creation.

The grace-period job uses a conditional downgrade so a stale scan cannot undo
payment recovery. Existing job cadence and quota allowances are unchanged.

Migration `20260831_0029` adds nullable scope/binding/Checkout fields and scoped
uniqueness constraints. It preserves old customer IDs and paid plans but leaves
legacy scope/bindings NULL. Existing customers require explicit owner review
before being attached to a scope; no automatic metadata adoption is performed.
Back up and validate on disposable PostgreSQL before production migration.

## Required owner actions before any real sandbox exercise

1. Build a reviewed Kall development runtime from remediated images and establish
   a verified HTTPS origin. Do not share keys in chat.
2. Inject the existing restricted key from `dev/kall/stripe` through the runtime
   secret mechanism and use the checked-in Kall IDs and unique billing scope.
3. Configure a sandbox webhook destination at the API's verified
   `/api/billing/webhook` URL, and verify the target deployment's migration,
   networking and TLS. Local disposable PostgreSQL validation has passed;
   see [its evidence](continuation/postgres-validation.md).
4. After explicit sandbox activation, test real hosted Checkout, duplicate
   delivery, portal upgrades/cancellation, delayed/out-of-order events, decline,
   72-hour expiry and recovery. Verify Clerk ownership and return routes.
5. Review those results and release separately. Live billing requires a separate
   code/config review; setting `STRIPE_LIVEMODE=true` remains rejected here.

Automatic tax is explicitly off. No tax readiness is claimed. Confirm legal
entity, jurisdictions/registrations, product tax codes and inclusive/exclusive
price behavior with qualified guidance before a separate tax activation.
No registrations were inspected or changed.

## Evidence and official references

See [local billing evidence](continuation/billing-security.md) for exact checks,
limitations and screenshots. No live card, Stripe CLI transaction, webhook
destination or PostgreSQL result is implied by mocked tests.

- [Stripe webhooks](https://docs.stripe.com/webhooks)
- [Checkout Sessions creation](https://docs.stripe.com/api/checkout/sessions/create)
- [Customer portal integration](https://docs.stripe.com/customer-management/integrate-customer-portal)
- [Subscription item billing periods](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end)
- [Invoice object](https://docs.stripe.com/api/invoices/object)
- [Stripe Python SDK](https://github.com/stripe/stripe-python)
- [Stripe tax setup](https://docs.stripe.com/billing/taxes/collect-taxes)
