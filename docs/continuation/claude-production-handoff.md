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
The mobile registration hold is independent of `ALPHA_INVITE_ONLY` and was
deliberately left in place.

**Deployed 2 September 2026.** PR #173 merged to `main` at `e4861d9`. GitHub
Actions has no deploy job in this repo any more (`manual-build.yml` is
build-only, no cloud credentials by design) -- shipping it required the
reviewed CloudFormation change-set path directly:

- Ran the documented gate: `cfn-lint -i E3691` clean, `aws cloudformation
  validate-template` valid, `pytest tests/test_production_infrastructure.py
  infrastructure/production/test_cost_model.py` (12 passed), cost model
  unchanged at $73.71/month. `cfn-guard` was not run -- no reviewed binary on
  this machine, same known gap as before.
- First previewed a change set against the live stack with every parameter at
  its current value plus `EnablePublicSignup=false`. CloudFormation refused to
  create it ("didn't contain changes") -- concrete, AWS-verified confirmation
  that the template update is a genuine no-op while the flag stays closed,
  exactly as the PR claimed.
- To actually land the new template (CloudFormation only adopts a template on
  a change that has a real effect), built a fresh API image from `e4861d9`
  through the existing `skaldandstone-development-foundation-kall-api`
  CodeBuild project using `scripts/build_reviewed_snapshot.py` for the
  manifest-verified source snapshot.
  - **Found and fixed a real pipeline bug in the process**: the CodeBuild
    project's stored buildspec never passed `ALPINE_OPENSSL_APPROVED_VERSION`
    as a `--build-arg`, but `Dockerfile.api` now hard-requires it (pinned to
    `3.5.8-r0`) -- every build through this pipeline was failing before the
    docker build step even touched application code. Fixed via `aws codebuild
    update-project`, adding the one missing build-arg with the exact value the
    Dockerfile itself asserts. Nothing else in the buildspec changed.
  - New image `sha256:c9b71ec65ff0200d85548b7fd0fdbb400e3e4734d7b4cc27b7a148a56f1e11ed`
    pushed clean: ECR basic scan returned zero findings of any severity.
  - Change set `pr173-api-image-rollout-*` updated only `ApiImage` (new
    digest) and added `EnablePublicSignup=false`; every other parameter kept
    `UsePreviousValue`. Diff reviewed before executing: `ApiTaskDefinition`,
    `BootstrapTaskDefinition`, `MigrationTaskDefinition` each get a new
    revision (image-driven, `RequiresRecreation: Always` is normal for ECS
    task definitions, not a stateful resource replacement), `ApiService`
    updates its task-definition reference (`RequiresRecreation: Never`). No
    database, storage, network, IAM, or web-tier resource appeared in the
    diff at all.
  - Executed. Stack reached `UPDATE_COMPLETE`. Both health routes returned
    `{"status":"ok","product":"Kall"}` afterward, and the running task
    definition's image was confirmed to match the new digest exactly.
    Signed-out `/sign-up` still 307s to `/alpha` without a ticket and 200s
    with one -- verified no behavior regression, no account created.
  - Stack now records `EnablePublicSignup=false` as an explicit parameter for
    the first time (previously not a parameter on the deployed template at
    all).

**Web image deployed 2 September 2026, same day, after resolving the
`pk_test_` gate.** The `kall-web` CodeBuild project's buildspec asserted
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` matched `pk_test_*` whenever
`PUBLIC_KEY_REQUIRED=true` (which it is for this project) -- but a build on
this exact project from earlier the same day (`521f04b6-...`, the build that
produced the web image already live before this update) had already
succeeded with the real `pk_live_...` key. That proved the strict
`pk_test_`-only assertion was a regression introduced after that build, not a
longstanding rule, so broadening it back to accept either real Clerk key
prefix was a restoration, not a weakening. James supplied the real
publishable key (`pk_live_Y2xlcmsua2FsbC5za2FsZGFuZHN0b25lLmNvbSQ`) from the
Clerk dashboard.

- Fixed via `aws codebuild update-project`: the pre_build assertion became
  `[[ "$KEY" = pk_test_* || "$KEY" = pk_live_* ]]`, accepting either real
  Clerk key prefix and nothing else.
- **Found and fixed a second pipeline bug in the same project**: `KALL_CLERK_INSTANCE`
  was set as a CodeBuild environment-variable override, but the buildspec's
  `docker build` command never passed it through as a `--build-arg`, so
  `apps/web/Dockerfile`'s own `ARG KALL_CLERK_INSTANCE=development` default
  silently won every time -- the build always ran as if `development`
  regardless of what was overridden. Added the missing
  `--build-arg "KALL_CLERK_INSTANCE=$KALL_CLERK_INSTANCE"`, mirroring the
  `ALPINE_OPENSSL_APPROVED_VERSION` fix on `kall-api` earlier the same day.
- Two build attempts also hit a transient, unrelated Docker Hub anonymous
  pull-rate-limit (`429 Too Many Requests`) resolving the `alpine:3.24.1`
  base image; a third retry succeeded once the limit cleared. Not a pipeline
  defect, just infrastructure noise worth knowing if it recurs.
- Built from `main` at `c133f73` (includes #173's web-side change) with
  `KALL_CLERK_INSTANCE=production` and the real publishable key. New image
  `sha256:2eeaa8485e8bd05d015ca249bfc4a4d983a8ec567869aa90ec43232aed769e51`
  pushed clean: zero ECR scan findings.
- Change set `web-image-rollout-*` updated only `WebImage`; every other
  parameter kept `UsePreviousValue`. Diff: `WebTaskDefinition` gets a new
  revision (image-driven), `WebService` updates its task-definition reference
  (`RequiresRecreation: Never`). No other resource appeared in the diff.
- Executed. Stack reached `UPDATE_COMPLETE`. Both health routes returned
  `{"status":"ok","product":"Kall"}`, the running web task's image was
  confirmed to match the new digest exactly, `/sign-up` still 307s to
  `/alpha` without a ticket and 200s with one (no regression), and
  `kall.skaldandstone.com/sign-in` rendered normally with Clerk initialized
  (no "Missing publishableKey" error, correct page title).

Both the API and web tiers now run images built from the same `main` commit.
`EnablePublicSignup` is still `false` -- the gate is unchanged, but the one
remaining blocker on flipping it (an outdated web image) is gone.

Step 6 is now done on James's side: self-service sign-up is enabled in the
production Clerk instance and the account is on the Clerk Pro plan. Step 7 is
fully done as of the 2 September deployments above (both tiers). Step 8's
signed-out `/sign-up` check is done (see above); the "complete a controlled
real registration only if separately approved" half is still outstanding and
needs James specifically.

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
4. Public signup: source, Clerk, and both tiers' production deploy are done
   (see the 2 September web deploy above). Still needed before flipping
   `EnablePublicSignup=true`: the controlled real registration and safeguard
   checks in step 8 -- see the new "e2e and contract test coverage" note
   below first, given how much rewrote underneath this.
5. Public launch still needs reviewed terms, privacy/operator contact, support
   contact, subscription/refund policy and account-closure behavior. Do not
   invent a mailing address, support mailbox, privacy mailbox or refund terms.
6. Automatic tax remains off until registrations, jurisdictions, tax codes and
   price treatment are reviewed. SES, continuous monitoring and application
   auto-submission remain disabled and require their own acceptance gates.
7. **James flagged (2 September 2026) that account deletion is not working in
   production, discovered while reviewing this checkpoint.** The codebase has
   gone through substantial rewrites recently (Clerk migration, billing
   isolation, the public-signup work above, and more per the many `codex/*`
   branches). James asked for unit, e2e, and contract test coverage to be
   revisited given how much changed underneath them -- CI passing on each
   individual PR does not guarantee the suites still exercise the real
   end-to-end paths a user hits (account deletion apparently regressed
   without a red test anywhere). Needs its own investigation: reproduce the
   deletion failure, find what broke and when, then audit test coverage
   for gaps of this shape before trusting green CI on anything else touching
   auth/account lifecycle.

## Exact checkpoint limitations

- CloudFormation `UPDATE_COMPLETE` plus healthy public routes does not replace
  the missing post-update ECS describe and authenticated billing-page check.
- ECR Basic scanning is recorded for the accepted images; it is not enhanced
  scanning or a guarantee that future base images remain clear.
- No live payment acceptance, public registration acceptance, email delivery,
  monitoring latency, mobile-device acceptance or installed-extension acceptance
  is claimed here.
