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

**Account deletion does not exist.** No endpoint, no Clerk-side cleanup, no
cascade. `CandidateProfile` holds encrypted phone, address, EEO and
work-authorization data, and there is currently no way for anyone to remove
it. This is the largest production-readiness gap I found and it is a
multi-part piece of work: a deletion endpoint, cascade across the foreign
keys, Clerk user removal, and a decision about whether deletion is immediate
or deferred. Worth planning deliberately rather than squeezing in.

**Payment failure grace period.** `invoice.payment_failed` currently has no
handling. Someone whose card fails mid-search should not be locked out that
instant. Needs a policy before Stripe goes live -- see `docs/STRIPE_SETUP.md`.

## Deferred by you

**Production Clerk instance.** Still on development keys with a 100-user cap.
You called this non-essential until we are closer to production. It blocks any
real signup volume when that changes.

## Needs you specifically

**The Chrome extension has never been loaded unpacked against a live posting.**
The whole writing half is unverified outside DOM tests, and the `country`
combobox in particular. This needs a human with a browser and a real
application form; I cannot do it from here.

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
