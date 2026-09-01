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
medium, and 2 undefined findings in their basic scans. The replacement source
contract is recorded in [runtime image remediation](runtime-image-remediation.md).
Replacement image builds, immutable digests, full scan review, RDS TLS, origin
TLS, and constrained-runtime tests remain required.

Run `scripts/check_aws_development_readiness.ps1` after authenticating profile
`skaldandstone-dev`. It is read-only, requires the exact project and selected
Region, checks the two secret records by metadata, and counts runtime resources.
It never calls `GetSecretValue`.

AWS access and mutations remain owned by the designated AWS task. This source
lane does not read secret values, build or upload images, start tasks, change
billing, or deploy infrastructure.

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
