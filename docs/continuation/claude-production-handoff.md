# Kall production handoff

Updated 2 September 2026 from canonical `main` at
`c45e94df2da70931b78a7dc445aa2ef2675c2533` before this documentation commit.
This is a handoff checkpoint. It contains no credentials, signing secrets,
invitation tokens, cookies or payment data.

## Live production state

- Public origin: `https://kall.skaldandstone.com`
- AWS project: `734702670689`
- Selected Region: `us-east-2`
- CloudFormation stack: `kall-production`
- Production Clerk instance: `ins_3IkINluSAXFwofdcHmZ10lbdyvJ`
- The invited `james@skaldandstone.com` production user previously completed
  Google sign-in. The authenticated dashboard and billing page loaded before
  billing activation, which proved the Clerk, BFF and local-user path.
- The Stripe activation change set `enable-kall-stripe-live` reached
  `UPDATE_COMPLETE`. It changed only the API execution-role secret permission,
  API task definition and API service task-definition reference.
- `https://kall.skaldandstone.com/api/health` and
  `https://kall.skaldandstone.com/api/kall/health` both returned
  `{"status":"ok","product":"Kall"}` after that update.
- A subsequent ECS describe call failed because the local AWS developer session
  had expired. Reauthenticate read-only and verify desired/running counts, task
  definition revision, deployment failures and target health before relying on
  the billing runtime.

## Stripe objects now configured

- Live Plus product `prod_VAvMNUYFhL2Kit`, monthly price
  `price_1UB0nkLDE8FHWLmdAPU6aofY`, USD 5, `metadata.app=kall`.
- Live Premium product `prod_VAvMM3BYCN82Ul`, monthly price
  `price_1UB0njLDE8FHWLmdmDCbWyPx`, USD 15, `metadata.app=kall`.
- Live webhook endpoint `we_1UB7wILDE8FHWLmdhcJGwm8t` at
  `https://kall.skaldandstone.com/api/billing/webhook`, scoped to the six events
  implemented by Kall.
- Kall-only live portal configuration `bpc_1UB8r1LDE8FHWLmdXGogNRS4`, with the
  two exact Kall product/price pairs, payment-method updates, invoice history,
  cancellation at period end and subscription price updates. Quantity changes
  are disabled.
- Secrets Manager record
  `arn:aws:secretsmanager:us-east-2:734702670689:secret:prod/kall/stripe-H9vuxd`
  contains only the restricted live key and webhook signing secret. Do not read,
  print, copy, rotate or replace either value unless the corresponding task is
  explicitly approved.
- `EnableStripeLive=true`, live object IDs and the portal ID are deployed. No
  live card, Checkout, Customer, subscription, webhook delivery, cancellation or
  refund has been exercised.

## Public signup request

James explicitly requested removal of the invite-only requirement. This
checkpoint paused before changing source, Clerk or production runtime settings.

**Status update.** Steps 1 to 5 and 7 are implemented on branch
`feat/public-signup-parameter`; step 4's "rendered template evidence" turned out
not to exist for the production stack, and the Guard policy did not pin
`ALPHA_INVITE_ONLY` (a `public_signup_defaults_closed` rule was added instead).
Nothing is deployed: `EnablePublicSignup` defaults to `false`. The mobile
registration hold is independent of `ALPHA_INVITE_ONLY` and was deliberately left
in place.

Step 6 is now done on James's side: self-service sign-up is enabled in the
production Clerk instance and the account is on the Clerk Pro plan. Step 8,
post-deployment verification, remains outstanding.

Kall's app-side gate is therefore now the only thing keeping registration closed,
and it is holding. Verified after the Clerk change:
`https://kall.skaldandstone.com/sign-up` returns 307 to `/alpha`, and returns 200
only with a `__clerk_ticket`. The deployed `ALPHA_INVITE_ONLY` is still `'true'`,
so both the middleware redirect and the `_assert_alpha_access` 403 are intact.
There is no half-open state.

One temporary consequence: because Clerk now permits self-service sign-up, a
person can create a Clerk account through Clerk's own hosted pages and then be
dead-ended by Kall's gate until this work deploys. That is a UX dead end rather
than an exposure - the account gets no Kall access - but it argues for deploying
the application side reasonably promptly.

The required source work is broader than a single Clerk toggle:

1. Add a production CloudFormation parameter such as `EnablePublicSignup`,
   defaulting to `false`. Map it deterministically to `ALPHA_INVITE_ONLY=false`
   only when explicitly enabled. Preserve the allowlist secret for rollback.
2. Remove or replace the production validator in `backend/kall/config.py` that
   currently rejects every production configuration with
   `alpha_invite_only=false`. Keep all Clerk-key, authorized-party, TLS,
   database, storage and billing checks intact.
3. Preserve `_assert_alpha_access` in `backend/kall/auth.py`; it already permits
   every authenticated Clerk user when the flag is false. Add production tests
   for both the default invite-only state and explicit public-signup state.
4. Update the three hardcoded production task-definition values in
   `infrastructure/kall-production.yaml`: API, migration and web. Update
   `tests/test_production_config.py`, `tests/test_production_infrastructure.py`,
   the production Guard policy and the rendered template evidence. Do not change
   `infrastructure/kall-alpha.yaml` unless a separate alpha policy is approved.
5. Replace invitation-only copy on production sign-in and sign-up pages with
   accurate public-account copy. Review the mobile registration hold separately;
   its release safeguard currently requires registration to remain disabled.
6. In the exact production Clerk instance above, enable self-service sign-up and
   remove the invitation restriction without changing Google OAuth, custom
   domain, session policy, MFA policy or the existing owner user. Verify the
   setting by reading the instance back.
7. Run focused Python tests, Ruff, production CloudFormation/Guard validation,
   web typecheck and build. Commit and push only a clean reviewed change, wait
   for required CI, then preview a production change set. Expected runtime
   changes are task-definition replacements and service references only.
8. After deployment, verify the signed-out `/sign-up` page in an isolated
   session without creating a synthetic production user. Then complete a
   controlled real registration only if separately approved. Verify existing
   invited-user access and account-deletion safeguards remain intact.

## Remaining acceptance and owner decisions

1. Reauthenticate the AWS CLI and verify the API service has converged after the
   Stripe task-definition replacement. Recheck alarms and both health routes.
2. Reopen `/billing` as `james@skaldandstone.com` and verify Plus, Premium and
   portal actions are enabled. Do not click Checkout until a controlled payment
   is immediately approved.
3. A live payment/refund exercise must verify Customer ownership, Checkout,
   webhook delivery and deduplication, entitlement change, portal cancellation,
   refund and final Free entitlement. It is a real financial action and needs
   fresh confirmation immediately before execution.
4. Public signup still needs the source, Clerk and production changes above.
5. Public launch still needs reviewed terms, privacy/operator contact, support
   contact, subscription/refund policy and account-closure behavior. Do not
   invent a mailing address, support mailbox, privacy mailbox or refund terms.
6. Automatic tax remains off until registrations, jurisdictions, tax codes and
   price treatment are reviewed. SES, continuous monitoring and application
   auto-submission remain disabled and require their own acceptance gates.

## Exact checkpoint limitations

- CloudFormation `UPDATE_COMPLETE` plus healthy public routes does not replace
  the missing post-update ECS describe and authenticated billing-page check.
- ECR Basic scanning is recorded for the accepted images; it is not enhanced
  scanning or a guarantee that future base images remain clear.
- No live payment acceptance, public registration acceptance, email delivery,
  monitoring latency, mobile-device acceptance or installed-extension acceptance
  is claimed here.
