# Kall Claude continuation handoff

Updated 9 September 2026 from canonical `main` at
`220c1135e228a0f5d06c23e501e55c3412764a01` before this documentation-only
commit. This file contains no credentials, cookies, bearer tokens, signing
secrets, invitation links, or payment data.

## Start here

- Canonical repository: `C:\Users\James\Documents\GitHub\Kall`
- Git remote: `https://github.com/Skaldandstone/Kall.git`
- Canonical branch: lowercase `main`
- Current source checkpoint before this handoff: `220c1135e228a0f5d06c23e501e55c3412764a01`
- Public web origin: `https://kall.skaldandstone.com`
- Current AWS project: `051722405355`
- Selected Region: `us-east-2`
- CloudFormation stack: `kall-production`
- ECS cluster: `skaldandstone-production`

Any reference to AWS project `734702670689` in Git history or older reports is
historical. Do not deploy to it or treat it as the current Kall project.

Before changing code, read `AGENTS.md`, the shared project routing and Linear
workflow documents named there, then inspect the current Linear issue SSE-168.
Linear owns work status. Source, CI, provider consoles, and runtime checks own
the implementation and acceptance evidence.

## Accepted release checkpoint

The current web release is live from source `220c1135e228a0f5d06c23e501e55c3412764a01`.
The production web image digest is
`sha256:9d89d68c0012faa0eeed1999cd74354b29e6127eec371f518a9924078f62bbb4`.
The API image digest is
`sha256:80a672390b03557fe1716f46961f07a3e954acf85f1e3bf56038440f6df2dcb2`.
Both ECS services were healthy at 1 desired and 1 running task after the web
update. CloudFormation stack status was `UPDATE_COMPLETE`.

The production database migration ran as the dedicated one-shot migration task
and exited 0. The database was verified at Alembic head `20260909_0035`.

The last full CI run for the released source was GitHub Actions run
`34413264072`. It passed the web build, 40 web Playwright tests, and 58
usability/accessibility tests.

Live signed-out checks passed:

- `/` returned 200.
- `/api/health` returned 200 with the exact Kall health payload.
- `/api/kall/health` returned 200 with the exact Kall health payload.
- `/api/me` returned 401 without a bearer token.
- `/api/mobile-release` returned Android latest version `1.1.6` and the Play
  testing enrollment URL.

Stripe live configuration and the OpenAI secret reference are deployed. This
checkpoint does not claim a new live Stripe charge, webhook round trip, or
signed-in OpenAI response was accepted on 9 September. Do not convert
configuration evidence into runtime acceptance evidence.

## Mobile release checkpoint

The accepted Android and iOS binaries were built from exact mobile source
`02d87d9bff6a4845afe505d8618066b21214acf1`.

- Android EAS build: `f9e590cb-8e68-4802-a550-92f7c5595450`
- Android version: `1.1.6`, version code `21`
- Google Play submission: `814c92db-e66a-4b8e-a926-41bd91289268`
- Google Play track/status: Alpha, `COMPLETED`
- iOS EAS build: `2ab298fa-b268-4a91-b6f8-e51b5395e7d1`
- iOS version/build: `1.1.6` / `9`
- App Store submission: `8419a7d0-326b-43f5-a0d0-b206ce247f84`
- App Store Connect app: `6809954928`
- iOS state: valid and ready for beta testing internally; external TestFlight
  review remains a separate provider action.

The native compiled smoke workflows passed before submission. Provider approval,
tester installation, and physical-device behavior remain acceptance checks.

### Mobile release guard

Pushes to `main` that touch the mobile paths listed in
`.github/workflows/mobile-android-build.yml` or
`.github/workflows/mobile-ios-submit.yml` automatically launch native EAS work
and store submission. Do not edit `apps/mobile/src/**`, mobile assets, plugins,
release scripts, app configuration, EAS configuration, Maestro tests, or mobile
package manifests unless a new Android and iOS release is intended. When one is
intended, bump the user-visible version and native build numbers as required,
run the compiled native smoke workflows, and verify both provider submissions.

## Coding queue

Work from SSE-168 and its related issues. Re-read Linear immediately before
starting because status can change.

1. Harden account deletion and session recovery. The web frontend must handle
   the bounded deletion request, sign-out, and ambiguous responses correctly.
   An arbitrary non-2xx user lookup must never be treated as proof that deletion
   succeeded. Add tests for success, timeout, network failure, server failure,
   still-existing identity, and an explicitly verified missing identity.
2. Complete authenticated recovery and MFA coverage. Exercise signed-in session
   refresh, forced login after an app version change, expired sessions, and MFA
   without logging or persisting auth material. Do not create a production user
   or bypass invite-only access to manufacture acceptance evidence.
3. Finish provider-backed communications. Complete SES sender delivery and
   mobile push provider acceptance. Local mocks and successful API calls do not
   prove inbox or device delivery.
4. Validate the browser extension on real supported ATS forms. Keep user review
   mandatory, never submit a form automatically, and document the exact sites
   and field types actually exercised.
5. Continue physical-device and tester-facing mobile acceptance, including
   Google sign-in, PDF resume upload, version update prompting, post-update
   cache/session reset, navigation, job search and consulting as parallel tracks,
   purchase restoration, and accessibility with the software keyboard open.
6. Continue web and mobile parity and polish from observed user feedback. Favor
   selectable chips and compact modules over keyboard-covered comma-separated
   entry fields. Preserve broad career support across arts, food service, sales,
   skilled work, consulting, and technical roles.
7. Treat the desktop application work tracked by SSE-165 as a separate release
   lane. Do not fold desktop packaging into a mobile or web hotfix.

Signed-in production journeys, live payment acceptance, actual email delivery,
actual push delivery, physical-device testing, and store review are explicit
acceptance activities. Never infer them from unit tests, build success, HTTP
status alone, or a provider object existing.

## Local validation

Use the smallest relevant set while iterating, then run every affected lane
before pushing.

Backend:

```powershell
python -m ruff check .
python -m compileall -q backend tests scripts migrations
python -m pytest
python -m alembic upgrade head
```

Use an isolated local test database for Alembic. Never point local validation at
the production database.

Web:

```powershell
Set-Location apps/web
npm ci
npm run build
npm run test:e2e
npx playwright test --config=playwright.usability.config.ts
```

The authenticated web E2E suite requires the existing protected CI test
credentials. Do not print, copy into documentation, or replace those values.

Mobile, only when a new mobile release is intended:

```powershell
Set-Location apps/mobile
npm ci
npm run validate:ios-alpha
npm run validate:android-play
npm run test:e2e
```

Then run the checked-in native EAS workflows referenced by the GitHub Actions
release jobs. A web-rendered Playwright pass is useful but does not replace the
compiled Android and iOS smoke runs.

## Production change rules

- Build and deploy only exact reviewed source. Record the source manifest,
  image digest, scan result, migration identity, and CloudFormation change set.
- Use CloudFormation for production infrastructure and service updates. Do not
  patch ECS services, task definitions, security groups, secrets, or databases
  directly as a shortcut.
- Run schema changes through the separate one-shot migrator before application
  rollout. Keep runtime and migration database roles separate.
- Preview the scoped change set and reject unrelated replacements or destructive
  changes.
- Do not read or log secret values. Refer to secrets by purpose and ARN only when
  evidence requires it.
- Do not perform a live Stripe charge, alter prices, invite testers, change OAuth
  configuration, or submit an external TestFlight beta merely to close a test.
  These need an explicit acceptance task and evidence from the responsible
  provider.
- Preserve the currently accepted mobile binaries unless a reviewed source
  change requires a new release.

## Handoff completion standard

For each completed item, leave `main` clean and pushed, link the exact commit and
CI run in Linear, record what was tested, and name any remaining provider or
human acceptance separately. Run the shared repository hygiene checker before
handoff. Do not delete, merge, prune, or rewrite other worktrees or recovery
branches based only on their names or age.
