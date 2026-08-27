# Waiting on you

Things that cannot move without a decision, and things that are done but that
you should know about. Written down because the overnight session's reminder
lives only in that session.

Last updated 2026-08-27.

## Needs a decision

**Retention window on generated documents — implemented at 12 months, change it if you disagree.**
Rendered resumes and cover letters now expire after a year and rebuild
byte-identically if anyone asks again. Twelve months was my choice, not yours.
One constant: `ARTIFACT_RETENTION_DAYS` in `backend/kall/services/documents.py`.

**Nothing schedules the retention job.** It runs as
`python -m kall.jobs.retention` and does nothing until something calls it. On
AWS it wants a daily ECS scheduled task on the existing `kall-api` image. Not
urgent -- there is nothing a year old yet -- but it is a silent no-op until
then.

**Account deletion is now built -- one piece of it is unverified.**
`DELETE /me` (self-service, type-your-email-to-confirm) and an admin console
button both call `services/account_deletion.py`, which walks the schema's own
foreign-key graph rather than a hand-written table list -- 70 of the 76
tables in the schema currently carry a user's rows, and a test populates
every one of them, including two-hop chains like
GeneratedDocument -> DocumentArtifact, and asserts zero survive under real FK
enforcement (SQLite defaults to not enforcing them; Postgres always does, so
the test turns enforcement on rather than trusting the happy path). The
support audit log is preserved rather than deleted -- its actor/target
columns are nulled, the same way `actor_email` already survives an actor's
account being removed.

The one thing that needed a decision mid-build: deleting the Kall row does
**not** sign anyone out of Clerk, so a browser with a still-valid Clerk
session would otherwise hit `ensure_local_user`'s "create on first sight"
path and silently resurrect a fresh, empty account on its next request. Fixed
two ways -- a best-effort call to delete the Clerk user outright, and a local
tombstone (`AccountDeletionRecord`, keyed by `clerk_user_id`) that refuses to
resurrect that identity even if the Clerk call fails or no Clerk key is
configured. The tombstone is fully unit-tested; **the actual Clerk-delete API
call has never run against a live Clerk instance** -- I found the SDK method
(`clerk.users.delete(user_id=...)`) and its signature by reading the
installed package, not by calling it. Worth one real run once the production
Clerk instance exists, alongside everything else on that line below.

**Payment failure grace period.** `invoice.payment_failed` currently has no
handling. Someone whose card fails mid-search should not be locked out that
instant. Needs a policy before Stripe goes live -- see `docs/STRIPE_SETUP.md`.

**Android app id -- I picked `com.skaldandstone.kall`, sanity-check it.**
You installed Android Studio to start the Android app, and `app.json` had no
`android.package` at all, which blocks any native build outright. I set it so
the first thing you tried would not just fail. **This is permanent once
published to Google Play** -- worth a deliberate look before that happens
rather than after.

## Deferred by you

**Production Clerk instance.** Still on development keys with a 100-user cap.
You called this non-essential until we are closer to production. It blocks any
real signup volume when that changes.

## Needs you specifically

**The Chrome extension has never been loaded unpacked against a live posting.**
The whole writing half is unverified outside DOM tests. The `country` field
specifically was worse than unverified -- characterizing it against a
synthetic fixture found it silently failed on any ARIA-combobox picker
(Workday, Greenhouse's newer forms, Lever all use one): it reported success
and showed the right text while the widget's own click handler, the thing
that actually sets what the form submits, never ran. Fixed in #118 by
dispatching a real click on the matching listbox option. That fix is tested
against a synthetic fixture, not a real ATS -- it still needs a human with a
browser against a live posting before it can be trusted; I cannot do that
from here.

## Worth knowing

**The AI features had been dead for about a month.** The configured model,
`gpt-5.1-mini`, was shut down by OpenAI on 2026-07-23, and three bare
`except Exception` blocks made a 404 indistinguishable from "no API key
configured". Fixed, default is now `gpt-5.6-luna`, and failures now say why.

**Buying Premium would have granted Plus.** The Stripe webhook hardcoded the
plan, and wrote only `Subscription.plan` while the quota service reads
`User.plan` -- so no purchase would have moved anyone's limits at all. Fixed
and tested before any real transaction could hit it.

**Generated documents were never a cost problem.** I had flagged them as the
clearest gap in the economics model. Recomputed: about $3.50 a month at 100k
users. The real issue was retention, not spend. `docs/UNIT_ECONOMICS.md` says
so now.
