# Kall production deployment

Kall runs as three resources: a PostgreSQL database, the FastAPI service, and the Next.js service.

**Infrastructure lives in [`AWS_DEPLOYMENT.md`](AWS_DEPLOYMENT.md).** It records
the reviewed CloudFormation release path and current holds. This runbook covers
the application configuration and the Stripe test-to-live cutover.

## 1. Before you start

The services must already exist per `AWS_DEPLOYMENT.md`. Run the one-shot
`alembic upgrade head` migration task with the dedicated migrator database role,
verify the expected head, and only then update the Uvicorn service. The runtime
database role must not have schema-migration permissions or RDS master
credentials. See the current
[runtime remediation contract](continuation/runtime-image-remediation.md).

## 2. Configure Clerk

Identity is Clerk's, not Kall's. Both services need credentials or the deploy fails outright:

- `kall-api` needs `CLERK_SECRET_KEY`. `config.py` refuses to start in production without it, so the container dies and the health check never passes.
- `kall-web` needs `CLERK_SECRET_KEY` at runtime (its `/api/kall` proxy mints the backend token from the session) and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` at **build** time, passed through `apps/web/Dockerfile`'s `ARG` - `next build` runs inside the image build and inlines the value, so a service-level variable alone does not reach it.

## 3. Configure API secrets

Set every API environment variable listed in `.env.production.example`. Never commit actual keys.

The production CloudFormation template generates and retains separate
`APP_SECRET_KEY`, `SENSITIVE_DATA_ENCRYPTION_KEY`, `kall_runtime`, and
`kall_migrator` secrets inside Secrets Manager. It never exposes their values
through stack parameters or outputs. The Clerk and invitation-access secrets
are external production vault inputs. Stripe remains a fail-closed sentinel
until the live provider setup is ready.

Start with Stripe test credentials and the Kall-only sandbox catalog:

Use the current nonsecret values from
[`deploy/kall-development.env.example`](../deploy/kall-development.env.example).
Keep `STRIPE_ENABLED=false` until the verified HTTPS origin, signed webhook and
sandbox acceptance checks below have passed.

The approved commercial model has two paid plans: Plus at USD 5/month and
Premium at USD 15/month. Use the current nonsecret sandbox Product, Price and
portal identifiers from [`deploy/kall-development.env.example`](../deploy/kall-development.env.example).
The Stripe secret key and webhook signing secret must come from the same
test-mode business and mode as every configured object.

Billing is not switched on yet -- checkout returns 503 and the UI says so.
The complete object allowlist and acceptance sequence are in
[`STRIPE_SETUP.md`](STRIPE_SETUP.md).

## 3a. Error tracking (Sentry)

Both services report unhandled errors to Sentry, org `skald-and-stone`
(https://skald-and-stone.sentry.io), projects `kall-api` and `kall-web`. The
SDKs are inert until a DSN is present, so local development and tests never
send anything.

- **A DSN is not a secret.** It can only *send* events to one project, and
  Sentry documents it as public. Both DSNs are therefore plain CloudFormation
  parameters (`SentryApiDsn`, `SentryWebDsn`) that land as `SENTRY_DSN` on the
  task definitions - not Secrets Manager entries. The current values are in
  `deploy/kall-production.env.example` and the Sentry project settings.
- **No image rebuild to turn it on.** The API reads `SENTRY_DSN` at start. The
  web app reads it server-side and serves it to the browser through a `<meta>`
  tag rendered by the root layout at request time, so nothing is inlined at
  `next build` and the fail-closed CodeBuild job needs no new build argument.
- **What leaves the process** is the exception, stack, HTTP method and route
  template. `backend/kall/observability.py` and `apps/web/lib/sentry-shared.ts`
  strip user identity, headers, cookies, bodies, query strings, full URLs and
  breadcrumbs, and disable tracing and session replay. Expected 4xx responses
  are not reported. Kall stores EEO and work-authorization data; keep those
  scrubbers in place when touching the SDK configuration.
- **CSP.** The browser SDK posts to
  `https://o4512015786377216.ingest.us.sentry.io`, allowed in `connect-src`
  in `apps/web/next.config.mjs`. A different Sentry org means a new host there.
- **To enable in production:** pass the two DSN parameters in the next
  reviewed change set. Verify by triggering one deliberate server error and
  confirming an issue appears under environment `production` in each project.

## 3b. Confirm the AI model answers

```bash
python -m kall.jobs.check_ai
```

Exit 0 means the configured model replied; 1 means no key is set (valid, but
every AI feature is then running on its deterministic fallback); 2 means the
key or the model is wrong, and the reason is printed.

Worth running before any demo. OpenAI retires model ids on a schedule, and
every AI call site here falls back silently by design -- so a retired model
looks exactly like the feature being switched off, with nothing raised.

## 4. Configure service URLs

The production service uses these exact HTTPS boundaries:

```text
FRONTEND_URL=https://kall.skaldandstone.com
CLERK_AUTHORIZED_PARTIES=https://kall.skaldandstone.com
KALL_API_URL=https://kall.skaldandstone.com
```

The web image must be built with the production Clerk publishable key and
`KALL_CLERK_INSTANCE=production`. The server-side BFF rewrites
`/api/kall/...` to `/api/...` and uses the public CloudFront host to avoid the
blocked public-ALB hairpin path.

Verify:

```text
GET https://kall.skaldandstone.com/api/health
GET https://kall.skaldandstone.com/api/kall/health
```

Both endpoints must return HTTP 200 before configuring Stripe.

## 5. Configure the Stripe test webhook

Create or update a test-mode snapshot webhook destination:

```text
https://kall.skaldandstone.com/api/billing/webhook
```

Enable at least:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Copy that destination's `whsec_...` value into `STRIPE_WEBHOOK_SECRET`, then restart the API service. Do not use a Connect thin-event destination for this billing endpoint.

## 6. Sandbox verification

1. Register a new Kall user.
2. Open Billing and confirm the page shows the free allowance.
3. Start Checkout and pay with Stripe's test card `4242 4242 4242 4242`.
4. Confirm Stripe redirects back to Kall.
5. Confirm the webhook delivery returns 2xx.
6. Confirm the user becomes Kall Plus in the database/UI.
7. Open the Customer Portal and verify cancellation and payment-method management.
8. Confirm repeated webhook delivery does not duplicate usage or subscription records.

Do not switch to live credentials until all eight checks pass.

## 7. Verify the production domain

Cloudflare owns `kall.skaldandstone.com`; the AWS stack outputs the ALB DNS name
for the DNS-only `origin.kall.skaldandstone.com` CNAME. Do not create Route 53
records or broaden ALB ingress. Verify viewer TLS, CloudFront-to-ALB TLS,
security headers, public health, signed-out protection, and an invited signed-in
BFF request before enabling live event delivery.

## 8. Live-mode cutover

Live mode needs separate Kall Plus and Premium products and prices, a restricted
live key, a Kall-only portal configuration, and a live webhook signing secret.
Test-mode IDs cannot be mixed with live-mode credentials.

Before cutover:

- create or verify live Plus at USD 5/month and Premium at USD 15/month;
- configure the Kall-only live Customer Portal with the same two-plan allowlist;
- create a live snapshot webhook destination;
- replace the complete live Product, Price, portal, restricted-key and webhook
  configuration together while `STRIPE_ENABLED=false`;
- verify live-mode object reads, then enable billing in a separate reviewed
  runtime change;
- perform one low-risk real transaction and refund it from the Stripe Dashboard;
- monitor API logs and webhook deliveries.
