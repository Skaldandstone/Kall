# Mobile canonical opportunity actions

## Confirmed defect

Cross-source discovery keeps one canonical `Opportunity` while retaining every
source-specific `Job` and `JobMatch`. The mobile Opportunities screen previously
joined feed rows to tracked opportunities only through `Opportunity.job_id`.
When the feed displayed another associated source, Save, Apply and Dismiss
incorrectly reported that the role was not tracked.

## Implemented contract

`GET /api/jobs/feed` now includes an additive `opportunity_id` for every source
job associated with the current user's canonical opportunity and selected
professional profile. Stable source job IDs are preferred. Legacy URL-only
source records remain resolvable until discovery repairs them. The mapping is
scoped by both user and profile and does not expose another profile's workflow.

Mobile uses `opportunity_id` for state changes and tracked-state display. It
retains its previous representative `job_id` lookup as a compatibility fallback
for an older backend. The opportunity ID, workflow state and history remain
canonical; source-specific match scores and evidence remain attached to their
own feed rows.

No schema migration is required. This change does not alter discovery,
deduplication, scoring, notifications, application submission, billing or cloud
configuration.

## Validation

- `python -m pytest tests/test_opportunity_source_identity.py -q`: 26 passed.
  The new black-box case covers a nonrepresentative source, legacy URL-only
  association, canonical state update and same-user profile isolation.
- `python -m pytest -q --disable-warnings`: 603 passed.
- `ruff check backend/kall/api.py backend/kall/services/opportunity_sources.py tests/test_opportunity_source_identity.py`: passed.
- `npx tsc --noEmit --incremental false` in `apps/mobile`: passed using the
  canonical checkout's existing installed dependencies through a temporary
  junction, removed after the check.

These checks do not prove authenticated physical-device behavior. No Clerk
users, external providers, live senders, AWS resources or deployments were
used.
