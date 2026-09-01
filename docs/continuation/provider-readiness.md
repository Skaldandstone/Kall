# AWS and Stripe development readiness

This record separates completed provider setup from runtime activation.

## AWS

The replacement development project is `734702670689` in the selected Region
`us-east-2`. The shared foundation, execution access, private repositories, build
jobs and product-isolated Clerk and Stripe records were created by the AWS owner.
Kall uses `dev/kall/clerk` and `dev/kall/stripe`. The repository does not retrieve
or print their values.

An attempted Kall-only runtime was created, then contained after provenance and
security review found root execution, inline migrations, RDS master credentials,
`sslmode=require`, broad `/api/*` routing, and an HTTP-only origin. The AWS owner
reported both services at desired/running count zero and the RDS instance
stopping. This repository lane made no AWS mutation. The flawed runtime is not
approved for use.

The contained Kall API and web images each reported 0 critical, 7 high, 1
medium, and 2 undefined findings in their basic scans. A later controlled build
reported the same counts and attributed them to Alpine OpenSSL `3.5.7-r0`, with
no fixed version reported by ECR. Both Dockerfiles now pin their official base
images by digest and intentionally reject that version. They require an exact,
reviewed successor package version before building. The replacement source
contract is recorded in [runtime image remediation](runtime-image-remediation.md).
Replacement image builds, immutable digests, full scan review, RDS TLS, origin
TLS, and constrained-runtime tests remain required.

The runtime stack now creates application services at desired count zero by
default. A one-shot master-only bootstrap creates or rotates exact migrator and
runtime roles, then a separate migrator task upgrades and verifies the exact
Alembic head. CloudFormation rejects service activation until a second reviewed
update records both successful stages. No hosted execution of those tasks has
occurred.

The bounded-session cost worksheet and disabled expiry controller are checked in
under `infrastructure/alpha-session`. The two-hour scenario is USD17.65, while a
24-hour cleanup delay reaches USD25.61 and fails the USD20 target. These controls
are source evidence only and have not been deployed.

Run `scripts/check_aws_development_readiness.ps1` after authenticating profile
`skaldandstone-dev`. It is read-only, requires the exact project and selected
Region, checks the two secret records by metadata, and counts runtime resources.
It never calls `GetSecretValue`.

AWS access and mutations remain owned by the designated AWS task. This source
lane does not read secret values, build or upload images, start tasks, change
billing, or deploy infrastructure.

## Clerk identity

The configured development publishable and secret keys belong to the same Clerk
instance. Read-only backend checks succeeded, and a fresh browser session reached
the hosted sign-in form without the earlier development-browser redirect loop.
Local tests must use the `localhost` hostname because Clerk's development flow
redirects there from `127.0.0.1`.

This proves the development key pair and sign-in page work. It does not prove a
production Clerk instance, an invited non-owner account, MFA, password recovery,
or a complete hosted sign-in and sign-out pass. Keep the alpha allowlist active
and complete one invited-user acceptance pass on the replacement HTTPS runtime.

## OpenAI

Kall has no Anthropic or Claude runtime dependency. Onboarding assistance,
resume intelligence, growth suggestions, interview preparation and compatibility
checks all use the shared OpenAI Responses API adapter with strict JSON schemas,
`store: false`, and model `gpt-5.6-luna`. The focused OpenAI suite passed 28 tests.

No Kall-specific `OPENAI_API_KEY` is configured in the replacement AWS project.
The product falls back safely when the key is absent, but live AI behavior is not
proved. Create a product-scoped secret through the AWS owner, inject only that
secret into the API execution role, and run one authenticated acceptance case for
each AI surface before calling those features enabled.

## Stripe sandbox

Provider receipts from the Stripe owner establish the shared sandbox business
`acct_1U9JeXPo4uRuCWxj`, Kall's two recurring offers, restricted sandbox key and
explicit portal configuration. The checked-in nonsecret configuration is
`deploy/kall-development.env.example`. `STRIPE_ENABLED` and `STRIPE_LIVEMODE`
remain false.

The missing pieces depend on the AWS runtime: a verified HTTPS origin, the
Kall-specific webhook destination, secure signing-secret capture, runtime secret
grants and a real authenticated sandbox acceptance pass. Do not create a guessed
webhook URL. Checkout return alone never grants an entitlement.

Automatic tax and live payments remain off. Before any later tax activation,
confirm registrations, product tax codes and whether displayed prices are tax
inclusive with qualified tax guidance.
