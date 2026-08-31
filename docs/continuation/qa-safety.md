# Parallel QA safety

Updated 2026-08-30. Owner: Kall integration and delivery.

Web and mobile Playwright suites create real synthetic identities in the shared
Clerk development instance. Their old global setup also swept stale identities
automatically. That sweep was limited to recognized test email patterns older
than one hour, but still mutated shared remote state on an ordinary test run.

## Guardrails

- Both configurations reject production secret and publishable keys before
  launching servers. The provider's testing helpers require development keys.
- Stale-user cleanup is disabled by default, including in CI. It requires the
  explicit environment setting `KALL_E2E_PURGE_STALE_USERS=1`.
- The cleanup helper also rejects production secret keys when called directly.
- Only old identities with a valid primary address and exclusively recognized
  test addresses are eligible. Mixed real/test identities are preserved.
- All listing pages are read before any deletion, preventing pagination shifts
  and partial deletion when a later listing request fails.
- Ordinary test teardown can still remove identities that the current test
  itself created. Running the existing authenticated suites still mutates Clerk;
  turning off the stale sweep does not make those suites offline.

Do not enable maintenance cleanup during parallel runs. An operator must first
confirm no active run depends on old synthetic identities. Do not copy production
credentials into test environments or print keys and provider response bodies.

## Local verification

From the repository root, with Node 22.6+:

```powershell
node --experimental-strip-types --test tests/clerk-test-safety.test.mjs
```

These tests mock every provider request. They cover default zero requests,
production-key refusal, mixed/real/recent identities, pagination, listing and
deletion failures, and already-removed users. They do not prove live Clerk login.

Verified locally: all 16 safety tests pass on Node 24.19.0. The same command is
included in the existing web CI job on Node 22, without adding a job or requiring
Clerk credentials. These guards have not yet run in hosted CI. The refreshed
reference-reminder PR has started CI successfully, so the earlier runner-start
billing restriction is no longer a confirmed current blocker.

The usability task owns a separate local fixture browser harness for this build.
Fixture UI checks and screenshots must be labeled as such. Production auth remains
unchanged and live Clerk integration remains a separate validation step.

Reference: [Clerk Playwright guidance](https://clerk.com/docs/guides/development/testing/playwright/overview).
