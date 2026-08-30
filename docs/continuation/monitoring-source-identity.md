# Canonical opportunity source identity correction

## Defect and behavior

The prior upsert copied every incoming source score onto one canonical opportunity without updating its representative job. A Greenhouse posting scoring 45 and a canonical Lever posting scoring 75 therefore produced a Greenhouse opportunity displaying 75, while monitoring dropped the qualifying Lever event because it could not find an opportunity keyed by the Lever job ID.

This correction retains canonical deduplication and uses two explicit identities:

- An opportunity is the stable user/profile workflow record. Its ID, first-seen key/date, state, notes, resume choice and dismissal history survive source and score changes.
- A source job owns its posting and JobMatch evidence. Notification observations and durable event keys continue to identify that source job and material fingerprint.

`source_records` gains additive `job_id` entries. Existing URL-only records resolve through the stored Job URL and are hydrated on upsert. Unknown source-record fields and unresolved historical records are retained. No database migration is needed. Former representative IDs remain associated and are checked before any canonical lookup; stale canonical hints still require a current representative identity match. Independent opportunity histories are never merged by a later title/location edit.

The representative is the highest-scoring currently allowed source with this user's/profile's JobMatch. Ties retain the current representative, then prefer the lowest stable job ID. Job ID, score and fingerprint move together. All JobMatch records and Application job IDs remain unchanged by that selection. The existing browser-capture upsert entry point now persists missing source evidence as well, so a second captured source does not lose its fit information. Legacy multi-source captures without any JobMatch rows also reconstruct their evidence before notification eligibility is evaluated; a lone legacy opportunity retains its previous compatibility behavior.

Monitoring, legacy schedules and notification preparation evaluate each source's own threshold and hard constraints. A qualifying source can generate an event even when another source represents the opportunity. A source below the threshold cannot borrow another source's score. Email preparation coalesces opportunity IDs, then delivery rechecks the actual assigned event source IDs, active user/profile, consent, suppression and current evidence. A queued source that later falls below threshold is skipped even if another source remains eligible. The rendered opportunity uses its current representative and matching score.

The existing durable unique event key remains `(user_id, job_id, fingerprint)`. Same-source repeated observations remain suppressed, and multiple source events for the same opportunity appear once in a summary. Claims, retries, ambiguous outcomes, timing and sender configuration are unchanged.

## Validation

All fixtures use local databases, synthetic posting data and disabled or mocked senders. No external feed, SES, Clerk, cloud, CI, push or merge operation is involved.

Regression coverage includes the original 45/75 threshold case, equal-score source order, a qualifying nonrepresentative source, material changes to a nonrepresentative, threshold/exclusion/pause changes before send, duplicate events, legacy URL-only repair, private user/profile evidence, browser capture and a full two-provider worker-to-delivery cycle. Representative swaps preserve application payload/status/job ID and saved/apply/not-interested/archived opportunity histories. Existing stable-ID and stale-alias regression suites remain applicable.

**Final backend suite: 512 passed in 81.81 seconds**, including 16 new source-identity regression cases. The focused source-identity/capture/digest-privacy run passed 25 tests in 5.59 seconds. Ruff, Python compilation and whitespace checks passed. No browser QA was rerun because this correction changes no frontend code.

The final controlled benchmark uses the existing five-profile/ten-board fixture: ten mock requests per cycle, 0/0/100 new events, and 44.785/0.494/12.229 seconds for baseline/unchanged/changed cycles. The backend suite was running concurrently, so timings include variable developer-host contention. The run records its own evidence in [monitoring-benchmark-source-identity.json](monitoring-benchmark-source-identity.json); earlier evidence is not overwritten. These SQLite developer-host timings do not prove CPU-limited Fargate or PostgreSQL performance. All prior disabled deployment, sender and budget gates remain in effect.

## Integration

Branch: `codex/kall-opportunity-source-identity`, based on integrated `a417889`, in a new clean worktree. The prior lane's inherited/borrowed dirty files were untouched.

This change owns upsert/source association and source-aware notification orchestration. The targeting lane owns only the department extractor/matching/material-fingerprint follow-up. Retain its `material_fingerprint` hunk when integrating; this correction does not edit that function. The reference reminder renderer is untouched. No UI, application submission behavior, infrastructure template or schedule enablement changes are included.
