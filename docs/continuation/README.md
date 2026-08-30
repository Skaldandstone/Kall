# Kall continuation delivery

The approved 2026-08-30 plan is being built in isolated worktrees. This record
tracks ownership and evidence; task creation does not mean implementation is done.

| Task | Task ID | Responsibility | Status |
| --- | --- | --- | --- |
| Kall integration and delivery | 01a0546e-37c4-78a3-8731-d26b2350af10 | Integration, shared QA safety, release checks | In progress |
| Kall: reference reminders and PR 169 | 01a054aa-6150-70d3-a45e-67bc3f95ffc0 | Dry run, reference email, regression tests | Repaired, integrated, PR updated; five required checks passed |
| Kall: functional areas and feature audit | 01a054aa-8757-7a02-bf5d-061725f9efa7 | Profile preservation, functional areas, current matching | Integrated; combined validation in progress |
| Kall: continuous monitoring and notifications | 01a054aa-a6a0-70d3-b8e8-d6fbf3a4ae8d | Shared feeds, monitoring, durable alerts, disabled deployment | Integrated; final combined checks running, pilot disabled |
| Kall: user-flow polish and accessibility | 01a054aa-c624-7b52-ae4f-de9ab36af8c9 | Current-flow fixes, responsive and fixture browser QA | Integrated; 30 combined UI/targeting browser cases passed |
| Kall: identity exploration and storyboard | 01a054aa-efc7-76d3-a952-33aa44a344b5 | Three unapproved visual directions and migration proposal | Reopened after Runestone feedback; Edition recommendation withdrawn |

## Integration order

1. Repair and validate reference reminders for existing PR #169.
2. Integrate profile preservation and deterministic targeting, including current
   hard exclusions and score refreshes that can move down as well as up.
3. Integrate monitoring on top of the shared matching helper, then validate
   additive migrations, leases, event deduplication and notification preferences.
4. Integrate current-flow usability fixes and perform fixture-based browser QA.
5. Deliver identity candidates for selection without replacing production assets.

The targeting task owns `refresh_discovered_job_match` in
`services/discovery_matching.py`. Monitoring owns scheduling, feed caching and
notification events. Reminder rendering is a small separate patch within the
notification-delivery service. Preserve all application and opportunity states.

## Boundaries and blockers

- Base is `b05cdcf`, which includes still-unmerged PR #169; `origin/main` was
  `ab0c35b` at coordination start. Do not assume child commits are based on main.
- Earlier required GitHub checks never started because of a payment/spending
  restriction. The new PR #169 run `33339187268` started on 2026-08-30 and has
  passed backend, web, web e2e, extension and mobile e2e. The PR remains unmerged.
  Do not bypass checks, repeatedly rerun them, or change billing.
- Monitoring is opt-in, five-minute company-board polling with initial global
  caps of five profiles and ten public boards. Incremental ceiling is $10/month.
- Keep cloud scheduling/deployment disabled pending measured workload/cost
  validation. No new NAT, database service, paid search or always-running worker.
- SES has no verified identity and remains sandboxed. No live sending is claimed.
- Preserve concurrent copyright and Stripe work outside these tasks.
- Do not change subscription pricing, production Clerk configuration, push
  credentials, or application-submission safeguards.
- See [QA safety](qa-safety.md) before running authenticated browser suites.

## Evidence at start

The planning pass ran 26 focused reference reminder, notification-delivery and
job-suite tests successfully. This is not evidence for later changes, full CI,
live email, real employer forms, or visual approval. Each task must supply its own
commits and validation evidence before integration is considered complete.

## Integration evidence

- `4ccfbb2`: shared browser-test safety guards, verified with 16 mocked provider
  tests and targeted TypeScript checking. No remote identities were mutated.
- `6494525` from the reference task is integrated as `2eec192` and fast-forwarded
  onto the existing PR #169 branch. The integration worktree independently passed
  all 38 focused reminder, email, notification and job-suite tests. No merge,
  deployment or live email has occurred. See [reference evidence](reference-reminders.md).
- `41f4792` from the targeting task is integrated as `f77221b`. Monitoring's
  `cd0b4a2` is the same helper patch and must not be applied a second time.
- `2749395` from the targeting task is integrated as `3b34910`. Its audit,
  implementation contracts and lane test evidence are in [the feature audit](feature-audit.md).
- Targeting follow-ups `13f0dd9` and `02ad005` are integrated as `b898d86` and
  `d0825d0`, with fixed-time digest tests and stale canonical-alias regression coverage.
- `cd1b1b6` from the UI task is integrated as `178da69`. See
  [current-flow evidence](usability.md), including the isolated browser harness.
- `edfecf3` from the identity task is integrated as `473e86a`. See the
  [review gallery](../../design/identity-exploration/index.html) and
  [page migration proposal](identity-storyboard.md). The first studies remain
  historical, unapproved candidates. James's Runestone feedback reopened this
  lane: the Edition recommendation is withdrawn pending alignment with Kall's
  dark Nordic and carved-rune design foundation. Production identity is unchanged.
- Monitoring `8a363ac`, metadata refresh `1fb404e` and UI `6fcf409` are integrated
  as `e5938d9`, `8575362` and `f56117d`. See [monitoring](monitoring.md) for
  behavior, controlled benchmarks, the conditional cost worksheet and activation gates.
- [Combined validation](integration-validation.md) distinguishes completed checks
  from remaining implementation and deployment gates.
