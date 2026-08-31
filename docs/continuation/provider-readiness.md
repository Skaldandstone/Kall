# AWS and Stripe development readiness

This record separates completed provider setup from runtime activation.

## AWS

The replacement development project is `734702670689` in the selected Region
`us-east-2`. The shared foundation, execution access, private repositories, build
jobs and product-isolated Clerk and Stripe records were created by the AWS owner.
Kall uses `dev/kall/clerk` and `dev/kall/stripe`. The repository does not retrieve
or print their values.

No Kall ECS service, task, database, load balancer, verified origin or public
webhook endpoint exists in that replacement environment. The six shared image
builds completed, but all six reported high findings and five reported critical
findings. Those images are not approved for runtime deployment.

Run `scripts/check_aws_development_readiness.ps1` after authenticating profile
`skaldandstone-dev`. It is read-only, requires the exact project and selected
Region, checks the two secret records by metadata, and counts runtime resources.
It never calls `GetSecretValue`.

The current browser session could reach AWS sign-in, but the browser safety layer
rejected choosing Google without provider-specific authorization. No bypass was
attempted. Because provider authentication is unavailable, no runtime or billing
resource was changed in this delivery.

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
