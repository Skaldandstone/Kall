# Kall continuation delivery

The approved 2026-08-30 plan is being built in isolated worktrees. This record
tracks ownership and evidence; task creation does not mean implementation is done.

| Task | Task ID | Responsibility | Status |
| --- | --- | --- | --- |
| Kall integration and delivery | 01a0546e-37c4-78a3-8731-d26b2350af10 | Integration, shared QA safety, release checks | In progress |
| Kall: reference reminders and PR 169 | 01a054aa-6150-70d3-a45e-67bc3f95ffc0 | Dry run, reference email, regression tests | In progress |
| Kall: functional areas and feature audit | 01a054aa-8757-7a02-bf5d-061725f9efa7 | Profile preservation, functional areas, current matching | In progress |
| Kall: continuous monitoring and notifications | 01a054aa-a6a0-70d3-b8e8-d6fbf3a4ae8d | Shared feeds, monitoring, durable alerts, disabled deployment | In progress |
| Kall: user-flow polish and accessibility | 01a054aa-c624-7b52-ae4f-de9ab36af8c9 | Current-flow fixes, responsive and fixture browser QA | In progress |
| Kall: identity exploration and storyboard | 01a054aa-efc7-76d3-a952-33aa44a344b5 | Three unapproved visual directions and migration proposal | In progress |

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
- Required GitHub checks never started because of a payment/spending restriction.
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
