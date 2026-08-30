# Continuous company-board monitoring

Status: implemented locally, cloud pilot disabled. This lane is stacked on reference-reminder PR #169 and the functional targeting ingestion helper. No live email, deployment, billing change, subscription change, Clerk migration, or application submission was performed.

## Delivered behavior

- Existing daily, weekday, and weekly schedules retain their cadence. `continuous` is opt-in; `MONITORING_ENABLED=false` is the separate rollout default. The hourly discovery runner never runs continuous schedules.
- The active pilot admits five profiles and ten distinct configured Greenhouse, Lever, or Ashby boards globally. Shared boards count once. Admission uses a database lease; the worker checks caps again, including subsequent source edits. Exceeding capacity stops the pilot with a visible error. Wider web search remains manual.
- A shared public feed cache contains public postings and validators only. Profile criteria, observations, opportunity states, and alert events remain in user-scoped tables. Private leases have user foreign keys so account deletion removes them. Public cache rows and the global worker lease can remain.
- One worker lease serializes the tick, with a 180-second expiry. Feed requests have bounded timeouts, concurrency two, 2 MiB/2,000-posting limits, conditional ETag/Last-Modified headers, and backoff. Rate-limit responses honor numeric Retry-After between five minutes and one day. Other failures back off to one hour. A failed or malformed feed never becomes an empty successful baseline.
- Work persists a schedule cycle, completed board markers and page cursor. A budget expiring after board A cannot mark board B successful; later ticks skip finished boards and resume the rest. Changed feed versions restart only an unfinished board scan. A highly unstable, oversized feed can delay completion and must fail the pilot performance gate.
- Initial activation and newly added boards seed observations without alerting on existing results. Changed profile criteria and current posting evidence refresh matches while preserving workflow states. Cached unchanged feed/profile combinations skip ingestion. Changed feeds ingest only postings whose material fingerprint changed or whose prior observation is missing. Historical matches refresh once per schedule, including empty or unavailable feeds.
- The service cooperatively stops starting work at its deadline. The CLI reserves ten seconds and has a hard 120-second watchdog covering a stuck synchronous call. Abrupt exit leaves a lease to expire and any `sending` delivery explicitly ambiguous. Database commits made before exit persist; incomplete transactions roll back.
- Unique `(user, job, material fingerprint)` notification events prevent duplicate alerts across profiles, retries and legacy scheduled discovery. Unsent events coalesce into one pending summary per user. Immediate mode sends at most one opportunity summary per user per five-minute cycle. Digest mode waits for the chosen local hour and sends at most once per local date. Morning Brief remains a separate notification kind.
- Delivery rechecks active user/profile ownership, opt-outs, minimum score, updated match evidence, hard constraints, suppression and workflow state. Current quiet hours and IANA time zones apply at send time. Waiting events are consolidated. Time calculations walk real UTC minutes across skipped/repeated DST hours. Preference changes clear timing-only deferrals, while preserving retry backoff after a provider failure.
- An atomic claim is persisted before contacting SES. Explicit throttles and definite connection failures retry with bounded backoff, up to four attempts. Definite permanent rejections fail. A timeout/lost response, unknown provider error, or stale `sending` row becomes `ambiguous` and is never automatically resent. SES SDK automatic retries are disabled because SendEmail has no idempotency token. Message IDs are saved on known success. Missing sender configuration leaves deliveries queued with zero attempts.

## API and UI

The existing schedule and preference endpoints are extended. Schedule responses include last successful check, next run, status and only that user's configured sources. Status distinguishes paused, worker disabled, awaiting baseline, delayed and unconfigured. Preference responses distinguish missing sender configuration. A configured address alone is not proof of SES verification or live delivery.

Discovery includes the pilot cadence and enable/pause switch, preserves saved time zone and form values on errors, and links to delivery settings. Notification settings expose immediate/digest delivery and paired quiet-hour controls, preserve values after save, provide load retry, and show the unconfigured sender warning. Current navigation and deep links remain unchanged.

The target is notification processing within ten minutes of a posting becoming visible in a healthy supported feed. This excludes publisher delays, outages, quiet hours, digest scheduling, backoff and unconfigured senders. Inbox arrival is never guaranteed.

## Local validation and measurement

Run from the isolated repository root:

```powershell
python -m pytest tests/test_monitoring.py tests/test_opportunity_notifications.py tests/test_monitoring_migrations.py tests/test_notification_delivery.py tests/test_scheduled_discovery.py tests/test_account_deletion.py -q
python scripts/measure_monitoring.py
cfn-lint deploy/monitoring.disabled.yaml
powershell.exe -NoProfile -File scripts/prepare_monitoring.ps1
```

The benchmark uses temporary SQLite and synthetic `httpx.MockTransport` feeds. No external feed request or sender is used. Five profiles share ten boards, with 20 postings per board. The three cycles are baseline, unchanged 304, then one new plus one materially changed posting on each board.

| Cycle | Mock requests | Posting/profile observations | New alert events | Local wall seconds |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 10 | 1,000 | 0 | 47.08 |
| Unchanged | 10 | 0 | 0 | 0.49 |
| Changed | 10 | 1,050 scanned; only changed/new ingested | 100 | 16.27 |

Evidence: [optimized measurement](monitoring-benchmark.json), [before optimization](monitoring-benchmark-before.json). The earlier unchanged/changed runs took about 40/100 seconds. These developer-host measurements do not establish CPU-limited Fargate runtime or PostgreSQL behavior. Baseline is deliberately resumable. Repeat with the actual image, database latency, representative board sizes and CPU limit before cloud activation.

Meaningful regressions cover concurrent claims, expired ownership, cross-user isolation, caps, conditional requests, backoff, malformed responses, bounded concurrency, exact between-board budget expiry across three ticks, profile changes on unchanged feeds, dry-run zero writes, same-cycle dedupe, current delivery eligibility, digest mode changes, quiet backlog, DST, provider uncertainty and missing configuration. The migration test upgrades a fresh database, downgrades to revision 27, and upgrades again while retaining an existing weekday schedule. Foreign-key-enforced deletion verifies private rows are removed.

Browser validation uses the UI lane's separate `usability-fixture`, never the real Clerk/global setup. Run from `apps/web` with `KALL_UI_PORT=3330` and `npx playwright test --config playwright.usability.config.ts monitoring.spec.ts`. Tests use real components with synthetic routes at 1440px and 375px. Build and DOM results are distinct from screenshot inspection. Backend verification on this lane: **460 passed** in the complete suite (99.73 seconds), plus Ruff and TypeScript checks. Migration, FK deletion and disabled template validation passed. The final isolated browser run passed **6 tests in 30.3 seconds**, covering notification mode persistence, keyboard selection, quiet hours, monitoring save failures, preserved form values, load retry and missing sender status. TypeScript passed again. Four screenshots were inspected at desktop 1440px and mobile 375px; controls were readable and the notification heading was corrected to avoid mobile overflow. This is current-flow visual review, not approval of a new identity. The follow-up department-evidence regression passed with the monitoring/opportunities/discovery-refresh suites: **32 passed in 11.90 seconds**; the full 460-test run predates that added regression.

Visual evidence: [monitoring desktop](monitoring-visuals/monitoring-desktop.png), [monitoring mobile](monitoring-visuals/monitoring-mobile.png), [notifications desktop](monitoring-visuals/notifications-desktop.png), [notifications mobile](monitoring-visuals/notifications-mobile.png).

## Complete incremental cost worksheet

Selected Region: **us-east-2**. Project context previously verified by coordination: 693272753663, FREE/ACTIVE. No free credits are subtracted from this estimate. Reconfirm plan and selected Region in AWS Settings before any approved activation.

730 hours/month at five-minute intervals is 8,760 tasks. Linux/x86 Fargate rates were read from the [regional AWS catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/us-east-2/index.json): $0.04048/vCPU-hour and $0.004445/GB-hour. At 0.25 vCPU and 0.5 GB, 60 to 120 billed seconds per task gives $1.80 to $3.60/month. [Fargate billing](https://aws.amazon.com/fargate/pricing/) starts with image download and has a one-minute minimum, so startup and image pull must be measured separately from the application watchdog.

| Increment | Review allowance/month | Assumption and gate |
| --- | ---: | --- |
| Fargate compute | $3.60 | 120 billed seconds/task, 8,760 tasks; not just Python runtime |
| Public IPv4 | $1.46 | One task address for 292 hours at $0.005/hour; include provisioning time |
| Logging and retained logs | $0.55 | Aggregate counters only, no posting bodies, 14-day retention; allowance for at most 1 GB ingest |
| Secrets/KMS requests | $0.30 | Four existing secrets per launch; no new secret storage; inspect actual keys and request rates |
| ECR storage | $0.10 | Reuse reviewed image, at most 1 GB incremental storage; no extra image per tick |
| Transfer | $0.20 | Public inbound feeds plus limited same-Region database traffic; verify routing and billed transfer |
| Existing database/storage | $0.20 | Incremental rows fit current capacity; no new database or scale-up; measure growth |
| Email | $0.10 | At most 500 opportunity emails/month with small bodies; re-estimate above this volume |
| Scheduler | $0.02 | 8,760 invocations, allowance without relying on free credits |
| Contingency | $1.37 | Startup/network/volume variability; not a hard AWS billing cap |
| **Review total** | **$7.90** | **Ceiling $10/month; deployment remains disabled until actual assumptions are validated** |

Supporting prices: [public IPv4](https://aws.amazon.com/vpc/pricing/), [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/), [Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/), [SES](https://aws.amazon.com/ses/pricing/), [Scheduler](https://aws.amazon.com/eventbridge/pricing/). The current SES pricing page lists Essentials at $0.16 per 1,000 emails, so 500 emails is $0.08 before additional charges. Verify the project's actual plan and prohibit paid plan/add-on changes in this release. Allowances beyond verified compute/IP rates are conservative planning inputs, not verified project billing or guaranteed prices.

Sensitivity matters: five users receiving one email every cycle would be 43,800 emails/month, beyond this worksheet's email assumption. Oversized images, slow starts, high churn, large feeds, excessive log volume, database resizing or a NAT route can also exceed $10. Keep deployment disabled if the complete forecast exceeds $10. No NAT gateway, new database, paid search provider or always-running worker is permitted. Existing hosting is excluded; incremental resize/storage costs are not. Review daily metrics during an approved pilot and projected monthly cost at days 1, 3 and 7. Pause expansion at projected/measured $10; disable the schedule if keeping it running would exceed the ceiling. AWS credits do not remove this release boundary.

## Disabled deployment and activation gates

`deploy/monitoring.disabled.yaml` creates no resources until someone separately deploys it. Its schedule is hardcoded `DISABLED`, task environment is `MONITORING_ENABLED=false`, sender is empty, and command omits `--send`. The offline `prepare_monitoring.ps1` script never invokes AWS and refuses a review estimate over $10. Existing hourly/daily billing, retention and reminder jobs are not changed.

The template uses one [EventBridge Scheduler ECS task](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/tasks-scheduled-eventbridge-scheduler.html), 0.25 vCPU/0.5 GB, an existing cluster, existing public subnets and security groups, and existing secret/role ARNs. It creates no resources outside us-east-2. Scheduler RunTask and PassRole permissions are scoped. Review task/execution roles for exact secret, logging and SES permissions; the existing production configuration validator also requires a Clerk secret, although this job never calls Clerk.

Before activation, coordination must review:

1. Required GitHub checks. Coordination verified all five checks green for PR #169 run 33339187268; the earlier runner-start payment/spending restriction did not recur. Combined integration CI remains a separate gate. No bypass or repeated retries.
2. Fresh and existing PostgreSQL migration, concurrent transactions and lease recovery against a disposable PostgreSQL database. Local SQLite is not proof of PostgreSQL isolation.
3. An actual image constrained to 0.25 vCPU/0.5 GB, representative feed size/churn, startup/image-pull duration, memory, request volume and database latency. Verify the two-minute budget and ten-minute healthy-feed processing target. Keep sender disabled during this validation.
4. Complete cost worksheet, public subnet internet route with no NAT, same-Region secret/image/database resources, least-privilege roles, cfn-guard/security review and deployment change set. `cfn-lint` alone does not prove cloud permissions or successful deployment.
5. Verified SES sender/domain, DKIM and sender configuration, recipient permission/opt-out handling, bounce/complaint operations, and production-access request. SES is currently sandboxed with no verified sender in the coordination snapshot. [Sandbox restrictions](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html) limit sending to verified recipients or the simulator. No live-delivery claim is made.
6. A selected initial cohort of at most five profiles/ten boards, baseline completion with zero activation emails, and explicit approval to enable the worker and then sender. Setting `--send` is a separate change from enabling board polling.

Operational recovery: inspect aggregate tick counts and schedule errors. Recover an expired idle lease on the next tick. Never manually replay an ambiguous delivery without checking provider logs/message evidence and explicit review. Failed definite deliveries stop after four attempts and retain their events. A sender/configuration fix must not reset event dedupe. Disable the single pilot schedule to pause cloud polling without changing legacy jobs or user workflow states.

## Integration notes

- Base helper `41f4792` was cherry-picked here as `cd0b4a2`; integrate it once only. Own follow-up adds optional `refresh_saved_matches=True` to ingestion, with monitoring passing false per page after one schedule-level refresh.
- `notification_delivery.py`: retain the reminder lane's reference renderer from `6494525`. This lane replaces opportunity rendering and delivery orchestration only. Retain the targeting lane's black-box `test_digest_profile_eligibility.py` when combining; its temporary renderer guard is superseded by `eligible_opportunities`.
- `opportunities.py`: this lane owns cadence/stale-running changes and the material fingerprint of public department/team/office evidence. Retain targeting's final stable-job/current-identity canonical dedupe implementation (`02ad005`) when integrating.
- `api_opportunities.py`: combine new schedule/preference request/response fields with targeting's existing opportunity read-surface filters.
- UI fixture/config are borrowed from the UI lane's `cd1b1b6` and must be integrated once. This lane contributes only `usability-tests/monitoring.spec.ts` in addition to its two production components and the notification wrapper mobile heading size. Browser QA used the UI lane's ToastHost fix so inline alerts/retry controls remain accessible; that borrowed change is not included here. Preserve coordination's corrected notification wrapper paragraph from `9025f23` when applying the one-line heading change.
- Shared copyright edits and untracked inherited files were not staged.
