# Reference reminder repair

Verified locally on 2026-08-30 in branch `codex/kall-reference-reminder-repair`,
based on `b05cdcf` (the existing, unmerged PR #169).

## Behavior

- A reference becomes eligible at 180 days since `last_confirmed_on`, or its
  creation date when it has never been confirmed. The permission-to-contact
  requirement and unavailable-reference exclusion are unchanged.
- `eligible_references` reads eligibility without queueing, flushing, or
  committing. The CLI's `--dry-run` counts that result directly. A rollback
  after calling the committing queue helper cannot undo committed deliveries.
- Normal execution still creates outbox deliveries using the existing queue
  helper. Dedupe keys retain the reference ID and baseline date, so a later
  reconfirmation starts a new reminder cycle.
- Email HTML escapes names, organizations, and dates. The subject is plain
  text. Copy distinguishes an actual confirmation date from the date a
  never-confirmed reference was added to Kall.

## Payload compatibility

New reference-reminder payloads add `baseline_date` and `baseline_source`.
The source is `last_confirmed_on` or `created_at`. `last_confirmed_on` now
contains the actual confirmation date or null, never a substituted creation
date. Existing reference IDs, names, organizations, kinds, and dedupe keys
retain their previous meaning. No schema migration is needed.

Old queued payloads do not record which source supplied their date. The
renderer accepts them and uses neutral wording about the saved date instead
of claiming a confirmation that cannot be established from the payload.

## Validation

Run from this worktree in PowerShell with local, synthetic test data:

```powershell
$env:APP_ENV='test'
$env:DATABASE_URL='sqlite://'
$env:SES_SENDER_EMAIL=''
python -m pytest tests/test_reference_reminders.py tests/test_reference_reminder_job.py tests/test_reference_reminder_email.py tests/test_notification_delivery.py tests/test_job_suites.py -q --disable-warnings
```

Result: **38 passed**. Existing dependencies emit deprecation warnings;
these are outside this repair's scope.

Coverage includes 179/180/181-day boundaries for both date sources,
reconfirmation, permission and availability exclusions, HTML escaping,
legacy payload compatibility, and the grouped daily-job contract. The dry-run
test compares every table through a fresh connection to a file-backed SQLite
database after the CLI exits, including an existing notification row.

The new persistence regression was also run against the original CLI loaded
from `b05cdcf` into memory. It failed on the additional committed notification
row, as expected. The worktree implementation was not modified for that check.

Ruff passed for all six changed Python files. `git diff --check` passed.
No live sender, external API, production database, deployment, or browser was
used. This is backend regression evidence, not live email or visual QA.

## Integration

- Apply this lane's commit on top of PR #169. Do not replace its original
  feature commit or bypass required CI.
- The only change in shared `services/notification_delivery.py` is
  `_reference_reminder_email`, including a function-local `html.escape`
  import. Preserve that function when integrating the monitoring lane's
  broader delivery changes.
- Stage only this lane's files. The inherited copyright changes in the
  extension, mobile profile screen, and web footer belong to other work.
- GitHub's runner-start payment/spending restriction remains an external
  release blocker. This lane did not rerun CI, change billing, push to the
  existing PR branch, merge, or deploy.
