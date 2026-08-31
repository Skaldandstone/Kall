# Kall continuation delivery

Latest: [main delivery and fresh combined validation](main-delivery.md).
James authorized integration and the remaining implementation on 31 August.
Earlier review/approval holds below are historical where superseded by that
instruction; technical safety and external authentication gates remain.

The approved 2026-08-30 plan is being built in isolated worktrees. This record
tracks ownership and evidence; task creation does not mean implementation is done.

## Current checkpoint, 2026-08-31

PR #170's single `build.yml` add/add conflict with updated reminder PR #169 was
resolved in `14ce61a`, retaining the exact existing PR #170 workflow content.
No workflow was enabled or dispatched. GitHub reports CI, Build and Ruff-fix
workflows disabled manually; the separate Manual build workflow on main remains
owner-dispatched with deployment off by default. Historical green runs for
`6494525` (PR #169) and `06fb54a` (PR #170) do not certify newer heads.

**Inscription is selected.** James's exact attached board matches the recorded
SHA-256. Selection is integrated as `08b0e74`; do not ask him to select the
direction again. Detailed screens, navigation and production masters remain
separate review/implementation steps. Edition remains withdrawn.

Studio's three scoped web/mobile/extension legal notices are integrated as
`2aaf208` from `b748333`. Canonical untracked files remain preserved. The notice
owner passed web/mobile TypeScript and 23 extension tests; physical-device and
installed-extension appearance have not been reviewed.

The separately authorized billing continuation is isolated on
`codex/kall-billing-isolation`, implementation `bab26bc`, with 587 backend and 42
combined synthetic browser cases passed. It is in [draft PR #171](https://github.com/Skaldandstone/Kall/pull/171),
stacked on PR #170, not part of PR #170 itself. PostgreSQL follow-up `826f993`
passed [90 isolated PostgreSQL contracts](postgres-validation.md),
fresh/legacy migrations and the controlled five-profile pilot benchmark.
Stripe connector reconnection, verified sandbox configuration and the actual
constrained cloud image/network remain gates. Live payments and tax stay disabled.

A subsequent **local-only** [Next image parser exposure review](next-image-parser-security.md)
reproduced the vendored ICNS/JXL worker failures and disabled unused optimization
and static image imports. Production build, 17 loopback HTTP assertions and 27
existing embed/upload tests passed. This reduces exposure; the parser remains
vulnerable and PR #171's published `4c42987` checkpoint is unchanged.

| Task | Task ID | Responsibility | Status |
| --- | --- | --- | --- |
| Kall integration and delivery | 01a0546e-37c4-78a3-8731-d26b2350af10 | Integration, shared QA safety, release checks | In progress |
| Kall: reference reminders and PR 169 | 01a054aa-6150-70d3-a45e-67bc3f95ffc0 | Dry run, reference email, regression tests | Repaired and integrated; historical five-job run passed, newer head has no check rollup |
| Kall: functional areas and feature audit | 01a054aa-8757-7a02-bf5d-061725f9efa7 | Profile preservation, functional areas, current matching | Integrated, including normalized department evidence |
| Kall: continuous monitoring and notifications | 01a054aa-a6a0-70d3-b8e8-d6fbf3a4ae8d | Shared feeds, monitoring, durable alerts, disabled deployment | Integrated with source-identity repair; pilot disabled |
| Kall: user-flow polish and accessibility | 01a054aa-c624-7b52-ae4f-de9ab36af8c9 | Current-flow fixes, responsive and fixture browser QA | Integrated; 36 combined browser cases passed |
| Kall: identity exploration and storyboard | 01a054aa-efc7-76d3-a952-33aa44a344b5 | Three visual directions and migration proposal | Inscription selected; detailed screens/navigation pending, Edition withdrawn |

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
- Preserve concurrent work. The notice owner's scoped commit is now integrated;
  the separately authorized Stripe implementation remains on its own branch.
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
- `52a5010` is integrated as `300bf8a`: visible department/team names now affect
  both score evidence and material fingerprints, without ID/order-only alerts.
- `a67063d` is integrated as `6cf6244`: canonical opportunities retain workflow
  history while source-specific evidence and notification eligibility agree.
  See [source identity](monitoring-source-identity.md), including the additional
  integration correction for unchanged duplicate sources arriving in later cycles.
- `782f25b` is integrated as `339ac69`: [round 02 gallery](../../design/identity-exploration/revision-02/index.html)
  contains Stave, Inscription and Fjord, with the original carved rune and a
  career-first Brief. James subsequently selected Inscription in `08b0e74`.
