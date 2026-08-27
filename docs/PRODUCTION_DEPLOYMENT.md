# Kall production deployment

Kall runs as three resources: a PostgreSQL database, the FastAPI service, and the Next.js service.

**Infrastructure lives in [`AWS_DEPLOYMENT.md`](AWS_DEPLOYMENT.md)** — ECS, RDS, CodeBuild, CloudFront, and the actual account topology. This runbook covers what sits on top of it and is not AWS-specific: the application configuration, and the Stripe test-to-live cutover.

## 1. Before you start

The services must already exist per `AWS_DEPLOYMENT.md`. The API container runs `alembic upgrade head` before starting Uvicorn, so its database account must be permitted to run migrations.

## 2. Configure Clerk

Identity is Clerk's, not Kall's. Both services need credentials or the deploy fails outright:

- `kall-api` needs `CLERK_SECRET_KEY`. `config.py` refuses to start in production without it, so the container dies and the health check never passes.
- `kall-web` needs `CLERK_SECRET_KEY` at runtime (its `/api/kall` proxy mints the backend token from the session) and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` at **build** time, passed through `apps/web/Dockerfile`'s `ARG` - `next build` runs inside the image build and inlines the value, so a service-level variable alone does not reach it.

## 3. Configure API secrets

Set every API environment variable listed in `.env.production.example`. Never commit actual keys.

Generate secrets locally:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Use the first value for `APP_SECRET_KEY` and the second for `SENSITIVE_DATA_ENCRYPTION_KEY`.

Start with Stripe test credentials and the Kall Plus test price:

```text
STRIPE_PRICE_ID=price_1U08lPIjMKrx5dSp2XBsn8to
```

The Stripe secret key and webhook signing secret must come from the same test-mode account as the price.

There are now **two** paid plans, so there are two prices. Billing is not
switched on yet -- checkout returns 503 and the UI says so -- and everything
needed to turn it on, including the second price and what to verify first,
is in [`STRIPE_SETUP.md`](STRIPE_SETUP.md).

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

Before a custom domain is available, use the provider-generated HTTPS URLs:

```text
FRONTEND_URL=https://<web-service-host>
NEXT_PUBLIC_API_URL=https://<api-service-host>
```

Redeploy the web service after changing `NEXT_PUBLIC_API_URL`, because public Next.js variables can be embedded at build time.

Verify:

```text
GET https://<api-service-host>/health
GET https://<api-service-host>/ready
```

Both endpoints must return HTTP 200 before configuring Stripe.

## 5. Configure the Stripe test webhook

Create or update a test-mode snapshot webhook destination:

```text
https://<api-service-host>/api/billing/webhook
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

## 7. Custom domain later

After acquiring a domain, use separate hosts:

```text
app.<domain>  -> Next.js service
api.<domain>  -> FastAPI service
```

Update `FRONTEND_URL`, `NEXT_PUBLIC_API_URL`, Stripe success/cancel URLs through the application configuration, and the Stripe webhook destination. Wait for valid TLS before enabling live event delivery.

## 8. Live-mode cutover

Live mode needs a separate product/price, secret key, and webhook signing secret. Test-mode IDs cannot be mixed with live-mode credentials.

Before cutover:

- create or verify a live `$4/month` Kall Plus price;
- configure the live Customer Portal;
- create a live snapshot webhook destination;
- replace all three Stripe environment variables together;
- perform one low-risk real transaction and refund it from the Stripe Dashboard;
- monitor API logs and webhook deliveries.
