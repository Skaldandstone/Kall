# Waiting on you

Things that cannot move without a decision, and things that are done but that
you should know about. Written down because the overnight session's reminder
lives only in that session.

Last updated 2026-08-27 (afternoon).

## Needs a decision

**Retention window on generated documents — implemented at 12 months, change it if you disagree.**
Rendered resumes and cover letters now expire after a year and rebuild
byte-identically if anyone asks again. Twelve months was my choice, not yours.
One constant: `ARTIFACT_RETENTION_DAYS` in `backend/kall/services/documents.py`.

**Nine jobs now need scheduling -- done (2026-08-28).** All nine now
actually run: EventBridge Scheduler starts `python -m kall.jobs.hourly`
(billing grace period, daily-brief queue, scheduled discovery, then the
notification outbox drain last, so anything queued that tick sends that
tick) every hour, and `python -m kall.jobs.daily` (retention plus the
certification, growth-milestone, work-authorization, and security-clearance
reminders) at 06:30 UTC -- each as a one-off Fargate task on the current
`kall-api` task definition with a command override; see
`docs/AWS_DEPLOYMENT.md`. One job failing does not stop its siblings
(`kall/jobs/_suite.py`, tested), and a failed suite exits nonzero so the
task shows up red. The accepted trade-off: the notification drain runs
hourly, fine while deliveries only queue (no email provider yet) -- revisit
the cadence when SES sending is switched on, if an hour-stale digest
matters then.

**A visa or sponsorship could lapse with no warning -- fixed.**
`WorkAuthorization.authorized_until` is collected and consumed by
autofill, but nothing anywhere ever compared it against today's date.
`services/work_authorization_reminders.py` mirrors the certification
reminder, on a fixed 60-day window since work authorization has no
per-row `reminder_days_before` and visa renewals routinely need lead time
measured in months.

**Security clearances were entirely unreachable from the UI -- fixed.**
`SecurityClearance` was fully wired on the backend (the generic
profile-resource CRUD already handled it) but `recordSchema.ts` never had
a "clearances" section, so nobody could ever add one. Needed zero new
backend code, just the missing form. Once reachable, `expires_on` had the
same no-reminder gap as `Certification`/`WorkAuthorization` -- fixed the
same way, a fixed 90-day window.

**Interview-prep question generation was skipping the AI quota entirely --
fixed.** Unlike every other AI-cost endpoint, `get_interview_prep` never
called `quota.assert_ai_allowed`/`record_ai_action` -- a Free-plan user
could trigger one real OpenAI call per application with no weekly cap and
no consumption recorded. Now metered the same way `api_growth.py`'s plan
generation is: only a genuine AI call counts, the free fallback question
list doesn't.

**A growth milestone could never actually be marked done, and had no
reminder either.** Nothing anywhere ever wrote to `GrowthMilestone.status`
or `completed_at` -- every milestone a plan generated stayed "not_started"
forever, with no button, endpoint, or anything else to change that. Fixed
with a real `PATCH /growth/milestones/{id}` and a status control on the
growth workspace's milestone cards. That in turn made a target-date reminder
meaningful (a milestone marked done can now actually be excluded) --
`services/growth_milestone_reminders.py` mirrors the certification
reminder built earlier, on a fixed 7-day window since a milestone has no
per-row `reminder_days_before` to configure.

**A settings-page promise that wasn't kept, fixed.** The notification
settings page's "Only matches at or above this score are worth an email"
control (`minimum_match_score`) was collectible and round-tripped through
the API, but `run_due_schedules()` queued a digest for every new
opportunity regardless of score. It's enforced now, same "no preference row
uses the model's default" convention `queue_daily_briefs` already uses.

**A privacy-adjacent checkbox that did nothing -- fixed.** The profile editor's
"Renewal required" checkbox on a certification, and its `reminder_days_before`
field, were both writable but nothing anywhere ever read either one -- so
checking that box had no effect at all. `services/certification_reminders.py`
now queues a real reminder through the existing notification outbox once a
certification's expiry enters its window; `reminder_days_before` (previously
hardcoded to its default of 90 with no way to change it) is now editable too.

**Automatic opportunity discovery now actually runs.** `DiscoverySchedule` had
a full data model, a create endpoint, and the UI already said "Next automatic
run" -- but nothing ever read `run_at_local`/`timezone`, and `run_discovery()`
had no caller except the manual "search now" button. A schedule someone
created just sat there, `enabled=True`, forever pending. `services/scheduled_discovery.py`'s
`run_due_schedules()` is the missing piece: it finds every schedule due right
now (gated on the account's real chosen hour, timezone, and weekday cadence),
runs the search, queues a digest through the existing notification outbox for
whatever's sitting in `state == "new"`, and disables (rather than endlessly
retrying) any schedule whose user or profile has since been deleted. Needs
the same hourly scheduling as the jobs above -- see `jobs/run_discovery.py --dry-run`
to check what would run without running it.

**The daily brief now emails, and it's personalizable.** `services/brief.py`
is the exact same logic `GET /me/morning-brief` already showed in the app --
extracted so the emailed version can never say something different from what
the page shows at that moment. `/settings/notifications` is a new page
letting someone actually set when it arrives, in what timezone, and the
minimum match score worth a new-opportunity email; before this there was a
`PUT` endpoint for that with no way to read it back and nothing calling it.
An account with no preference set gets the model's own defaults (8am UTC) --
there being no separate onboarding step for this, defaulting to "excluded"
instead would have meant emailing nobody ever.

**Found while checking for the same kind of drift that caused the earlier
plan-mapping bug: a testimonial could be shown on a public career page
without ever being marked approved.** `career_page.py`'s own filter checked
three flags and never `status`; a sibling endpoint already required
`status == "approved"`, this one didn't. Today's one caller always sends
both together, so nothing was actually exposed in practice -- fixed on both
the write side (moderate() now refuses it) and the read side
(career_page.py checks status directly too, as a second independent guard
on the one thing the whole feature exists to get right).

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

**Payment failure grace period -- decided and built: 72 hours.** A card that
fails keeps its paid-tier limits for 72 hours from the *first* failure (a
retry that fails again does not reset the clock), then automatically
downgrades to Free. `jobs/billing_grace_period.py` enforces it; nothing
schedules that job yet, see above. The downgrade notification sits in the
same notification outbox as everything below, queued until an email provider
exists.

**Android app id -- settled, not urgent.** `com.skaldandstone.kall` is set in
`app.json` so a local `expo run:android` doesn't fail outright. You've said
we are **not at a publishing spot yet**, so there is nothing to act on here
until that changes -- flagged only because the id becomes permanent the
moment a Play Store listing exists, so it is worth one more look right before
that day, not before.

**Notification infrastructure now exists -- no email provider is picked yet.**
This came up while discussing the retention window: James pointed out that
email/push infrastructure is needed anyway for the daily brief and new-
opportunity alerts, so it made more sense to build the real thing than a
one-off retention notice. `services/notification_delivery.py` drains the
outbox (`NotificationPreference`/`DeviceRegistration`/`NotificationDelivery`,
which already existed with nothing reading them); `services/notifications.py`
sends email through SES once `SES_SENDER_EMAIL` is set to a verified address --
until then, deliveries sit queued rather than failing, by design, so this
merges and works correctly with zero provider configured. Picking and
verifying the actual sender address is on you, see the setup runbook. Push
notifications have nowhere to go regardless of that choice -- mobile push
needs Firebase Cloud Messaging and APNs credentials/developer-account setup
that do not exist in this repository at all.

**No retention-specific notification was built, on purpose.** The original
question was whether to notify someone before their rendered resume expires.
It doesn't need to: expiry only deletes a redundant *rendered file* the
system can rebuild byte-identically, for free, on the next request -- nothing
the person experiences is actually lost. Say so if you want one anyway now
that the outbox exists to carry it.

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

**A paying Premium subscriber could be wrongly capped submitting an application -- fixed.**
`services/billing.py`'s `assert_submission_allowed` predated the tiered plan
system and hardcoded a "plus"-only check against a separate, disconnected
usage counter than the real one in `quota.py`, on the live submission-attempt
endpoint (`POST /submissions/{id}/attempt`). Decided: a connector submission
is the same "applying" event the `applications` meter already counts for a
manual kanban move to Submitted, so it draws on that same weekly meter rather
than getting its own. It only consumes on a genuinely new attempt --
`find_attempt` distinguishes that from an idempotent replay of an
already-attempted submission, so retrying a submission never double-charges.
The old dead machinery (`quota_status`, `assert_submission_allowed`,
`ApplicationUsage`, `FREE_APPLICATION_LIMIT`, `GET /billing/status`) is
removed -- `GET /me/usage` (`quota.snapshot`) was already the live equivalent
and nothing in apps/web called the old route.

**A privacy toggle that could never be granted -- fixed.** `identity.postal_code`
is `OPT_IN` for autofill, same as phone and address, and the consent check
fails closed with no rule -- but the privacy settings page's field list never
listed it, so nobody could ever grant that scope. The backend read/write path
was already correct; it just needed adding to the page.

**Run history said it recorded a search query it was actually discarding.**
`run_discovery()` called `build_ats_queries()` and threw away the result --
the comment above it claimed "ATS Search records the broader hidden-market
query in run history," but `SearchRun` had no column to put it in, so history
only ever showed the provider label, never the query. `SearchRun.ats_search_query`
now stores it per run, since a profile's titles/keywords/exclusions can change
between runs and a past run should keep showing what it actually searched for.

**A posting flagged dead kept showing up anyway -- fixed.** Marking a posting
`dead_link` only ever blocked it from being re-imported on a *future*
discovery run; it did nothing to a `JobMatch`/`Opportunity` a previous run
had already created. `GET /jobs/feed` and `GET /opportunities` now both
re-check suppression on read, symmetric with the write-side guarantee
`discovery.py` already had.

**A connector submission never left its pre-submission stage -- and could
have double-charged.** `POST /submissions/{id}/attempt` created a
`SubmissionAttempt` and charged the applications quota, but never advanced
`Application.status` to `SUBMITTED` the way the other two "applying" paths
already did. Left unfixed, dragging that same card to "Submitted" manually
on the kanban board later would have charged the applications quota a
*second time* for one real submission -- found and fixed before any real
account could hit it. The "confirmed"-only status gate on that endpoint now
also accepts "submitted", so a client retrying an already-succeeded attempt
can still replay it idempotently.

**Three more CareerProfile fields were unreachable after creation, and
pausing a profile was silently wiping equity preference -- both fixed.**
`employment_types` and `target_bonus_percent` could never be set or edited
by any endpoint; `minimum_total_comp` could be set once at onboarding but
never edited or even shown again. Same gap as `equity_preference` earlier.
While wiring these up, found that `StrategyTab.tsx`'s Pause/Reactivate
button resends the whole profile through the same full-replace PUT the
edit form uses, and had already been missing `equity_preference` -- every
pause or reactivate was silently resetting it to unset. Fixed alongside
the three new fields.

**The resume anti-tampering check could never actually fire -- fixed.**
`GeneratedDocument.status` defaulted to `"generated"` and nothing ever
advanced it to `"finalized"`, even though `finalized_at` was already being
set at the same moment. The submission-preview code filters on exactly
that status to snapshot which documents were approved, so that snapshot
was always empty, and the check comparing it against a resubmission's
current documents was comparing nothing to nothing -- a resume regenerated
or edited after approval but before the actual ATS submission would never
have been caught. Cover letters don't have a `GeneratedDocument` row at
all yet, which is a separate, larger gap this did not touch.
