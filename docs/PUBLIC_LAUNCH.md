# Going public: turning off invite-only

Public sign-up is a deployment decision, not a code change. Everything in the
clients already supports it; what follows is the order to flip it in, what to
verify at each step, and the go/no-go record `docs/PRODUCTION_READINESS.md`
requires before public signup counts as accepted.

## What is already public-ready

- **Mobile (iOS and Android).** `apps/mobile/app.json` sets
  `extra.allowRegistration: true`, and since a5ecb09 (2026-09-13) release builds
  follow app.json like any other build instead of forcing the gate closed.
  `RootNavigator` therefore exposes the Register screen and `LoginScreen` does
  not render the "Invite-only alpha" note. `KALL_MOBILE_ALLOW_REGISTRATION` is
  only an explicit per-build override for fixtures and e2e runs.
- **Backend.** Public sign-up is a supported production state. `config.py`
  requires `ALPHA_INVITE_ONLY` to be set explicitly in production (an unset
  variable is refused rather than silently opening registration) and requires the
  allowlist to stay populated when it is `false`.
- **Infrastructure.** `infrastructure/kall-production.yaml` exposes
  `EnablePublicSignup`, which drives `ALPHA_INVITE_ONLY` in the API, migration,
  and web task definitions.

## Order of operations

The client already shows a Register button, so the account-creation path is only
as open as the backend and Clerk allow. Until both are flipped, a new user who
taps Register is refused with "This private alpha requires an invitation." Flip
the server side first, then verify, then record the App Review evidence.

1. **Confirm the allowlist secret is populated.** The stack keeps it wired so
   invite-only can be restored by parameter flip. If it is empty, the API will
   refuse to start once public sign-up is on — check before, not after.
2. **Enable self-service sign-up in the production Clerk instance.** The stack
   parameter only relaxes Kall's own gate; Clerk is the other half, and without
   it registration still fails.
3. **Set `EnablePublicSignup=true` on the production stack.** Create the change
   set, inspect the complete change-set actions and validation events, then
   execute. Expect `ALPHA_INVITE_ONLY=false` in all three task definitions and a
   task rollout.
4. **Verify against production**, from a device and an account that has never
   been invited:
   - Register a brand-new account on iOS end to end, through email verification
     and device confirmation, into a usable workspace.
   - Repeat on the web app.
   - Confirm an existing invited account still signs in unchanged.
   - Confirm the new account lands on the `free` plan with correct quota meters.
   - Delete the new account from Workspace → Delete Account and confirm the data
     is gone and the session ends.
5. **Watch the first hours.** Sentry for auth and registration errors, and the
   sign-up rate against capacity. Public registration is the one change that
   makes load a function of strangers rather than of the invite list.
6. **Record the go/no-go** in the table below. `PRODUCTION_READINESS.md` requires
   public signup to carry its own record, separate from live billing, sender
   activation, monitoring, and application submission.

## Rollback

Set `EnablePublicSignup=false` and execute the change set. `ALPHA_INVITE_ONLY`
returns to `true` in every task definition and the invitation gate resumes with
the retained allowlist. Accounts created while public sign-up was on keep
working: the gate is checked per request against the allowlist and each Clerk
account's `alpha_access` metadata, so decide deliberately whether those accounts
should be granted that metadata before closing the gate again.

## Relationship to the iOS 2.1 review response

Apple asked for a recording of the "account registration, login, and account
deletion flows" (see `docs/app-review/2026-09-ios-2.1-response.md`). Record it
only after step 4 passes. A recording made while the gate is still closed would
show a Register button that ends in a refusal — a worse outcome than the original
rejection, and the fastest route to a second one.

## Go/no-go record

| Item | Value |
| --- | --- |
| Decision | Ship public sign-up (invite-only ends) |
| Decided by | |
| Date | |
| Allowlist secret populated | |
| Clerk self-service sign-up enabled | |
| `EnablePublicSignup` set to true (change set ID) | |
| iOS new-account registration verified | |
| Web new-account registration verified | |
| Existing invited account unaffected | |
| New account on free plan with correct quotas | |
| Account deletion verified | |
| Sentry clean after first hour | |
| Rollback rehearsed or accepted as parameter flip | |
