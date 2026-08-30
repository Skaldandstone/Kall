# Functional-area targeting and disconnected behavior audit

Lane: `codex/kall-functional-area-targeting`, based on `b05cdcf`. No deployment, live email, billing changes, or application submission was performed.

## Implemented behavior

Career Strategy edits and onboarding now expose functional areas and excluded keywords. Edits, pause/reactivate, and unrelated API updates preserve omitted values. Explicit empty arrays still clear a field. Numeric zero survives round trips, including minimum compensation, bonus, and maximum travel.

Functional areas broaden the existing title OR group with a small, deterministic catalog of related-role phrases. Industry, location, include-keyword and exclude-keyword query clauses remain unchanged. Matching awards one bonus of up to 10 points when the posting contains a selected area or related phrase. The explanation identifies the area and posting phrase. No evidence means no penalty or exclusion. Empty areas leave existing scores unchanged. Scores remain capped at 100. These are search heuristics, not assertions about a person's qualifications, and make no AI calls.

Discovery refreshes normalized posting fields, JobMatch scores and explanations, and Opportunity scores, including decreases. A subsequent discovery run also refreshes previously stored matches after profile or posting edits even when the fetched feed is empty. Existing workflow state, notes, and dismissal history remain intact. A materially changed dismissed posting stays `not_interested`; its current fingerprint changes while the dismissed fingerprint remains available. Stable job identity takes precedence over cross-source canonical matching. Updates retain the first-seen canonical key so a title/location edit cannot collide with a different tracked opportunity or merge application histories.

Excluded historical matches remain stored for history with score zero, but are ineligible. Job feed, Opportunity list and Morning Brief also apply current hard constraints at read time, before the next discovery run. Morning Brief excludes paused profiles and suppressed dead links. Existing application records and their state are untouched.

## Audit findings

| Input or flow | Classification | Evidence and disposition |
| --- | --- | --- |
| Strategy save and pause/reactivate replaced functional areas and exclusions with empty arrays | Confirmed defect, repaired | StrategyTab now submits real fields on save and only name/status on pause. Career profile PUT preserves omitted fields. |
| Zero compensation, bonus and travel disappeared through truthiness checks | Confirmed defect, repaired | Shared optional-number parser distinguishes blank from zero; read view displays zero bonus/travel. |
| Functional areas persisted but had no creation/edit UI, query expansion or score contribution | Confirmed disconnected behavior, repaired | Shared UI input, catalog endpoint, deterministic query expansion and single evidence bonus. |
| Existing matches retained old scores and posting content | Confirmed defect, repaired | Network-free ingestion refreshes existing rows in both directions; empty-feed regression covers profile edits. |
| Posting edits could reset dismissed workflow state | Confirmed defect, repaired | Preserve every existing state, including `not_interested`; fingerprint history remains separate. |
| A title/location edit could collide with another Opportunity canonical key | Confirmed defect, repaired | Preserve first-seen key and stable job-id lookup; regression retains two independent saved/application opportunities. |
| Previously matched exclusions could remain visible before discovery | Confirmed defect, repaired | Read-time hard constraints on job feed, Opportunity list and Morning Brief. Legacy digest render safety is a separate follow-up, superseded by monitoring's delivery eligibility helper. |
| Target titles, industries and included keywords | Intended existing behavior | Query constraints and additive scoring remain; functional areas join the title OR group rather than changing industry/location clauses. |
| Country/region and excluded keywords | Intended hard constraints | Existing `is_out_of_scope` handles explicit mismatches; unknown location is not rejected for missing evidence. Functional bonuses cannot override these constraints. |
| Work type, minimum base, travel, relocation and equity | Intended existing soft signals | Existing matcher scoring retained. Travel zero now reaches it correctly. Text signals do not prove a benefit is offered. |
| Employment type, target/stretch base, minimum/target total compensation and target bonus | Separately scoped comparison features | Stored and rendered, but currently not consumed by deterministic matching. This lane does not claim these preferences are enforced. Need explicit posting-data and comparison contracts before adding filters. |
| Public career page excludes private search strategy | Intended privacy boundary | `api_career_page.py` uses allowlisted candidate, employment and professional-record fields. It does not publish private CareerProfile targeting or compensation strategy. Sensitive reference contacts, EEO and authorization remain outside the public page. |
| Employer autofill does not use functional areas as experience | Intended privacy and accuracy boundary | `services/autofill.py` sources identity, employment, education and authorization under existing consent tiers. Desired roles are not claimed qualifications. Review and manual submission safeguards remain unchanged. |
| Website URLs and professional records | Intended existing behavior | Candidate website URLs already feed autofill; public career-page record allowlists exist. No parallel data model added. |
| Delivery modes, monitoring, board cache and schedule state | Separate implementation lane | Monitoring owns schedules, providers and notification events. This lane provides reusable cached-feed ingestion only. |
| Native location multi-selects and placeholder-only older onboarding labels | Existing usability debt | New fields have visible labels and help text. Browser review found no page overflow; broader onboarding polish remains with UI lane. |

## Public interfaces and integration

- Existing `POST /api/me/professional-profiles` already accepts `functional_areas` and `exclude_keywords`; UI now sends them.
- Existing `PUT /api/me/career-profiles/{id}` remains compatible with full payloads but preserves omitted fields. Name is still required; explicit `[]` or nullable `null` clears a field. Updates advance `updated_at` for refresh detection.
- New authenticated `GET /api/me/career-profiles/functional-areas` returns `{areas: [{name, related_roles}]}`. Suggestions are optional; custom comma-separated phrases remain valid if the request fails.
- `services/functional_areas.py` owns the catalog and shared expansion/evidence functions. Queries expand at most five areas, plus eight target titles, with at most 33 role phrases. Scoring checks selected areas in order and awards only one bonus. Existing constraints keep their existing query caps.
- `refresh_discovered_job_match(session, *, user, profile, job)` returns an eligible `JobMatch` or `None`, with an ownership guard and no provider calls.
- `ingest_discovered_jobs(session, user, profile, jobs, *, max_posting_age_days=None)` consumes cached `DiscoveredJob` objects and returns counters plus eligible `opportunity_ids`. It commits rows under the existing discovery transaction convention. An ID can represent an existing match; callers must not treat every ID as newly discovered or alertable.
- No schema migration is needed for this lane. No cadence or notification preference is changed.
- Interface commit `41f4792` was integrated by root as `f77221b` and by monitoring as an equivalent commit. Do not apply it twice.
- Shared-file changes in the final targeting commit: `api_opportunities.py` changes only the Opportunity list query/filter and import; `services/opportunities.py` changes only canonical-key preservation in upsert. Monitoring owns schedule and provider hunks. `brief.py` changes only current match eligibility.
- Safe fixture/config files copied from the UI lane are intentionally not included here. Integrate UI's `usability-fixture/**` and `playwright.usability.config.ts` before running this lane's `usability-tests/functional-areas.spec.ts`.

## Validation evidence

On 2026-08-30 in isolated worktree `C:\Users\James\.codex\worktrees\0028\Kall`:

- `APP_ENV=test`, `DATABASE_URL=sqlite:///./kall.db`, `python -m pytest -q --disable-warnings`: **446 passed** before the separate legacy digest follow-up. Existing tests use isolated SQLite fixtures. An earlier run using the non-default `sqlite://` environment override had one configuration-expectation failure; rerunning with the repository default resolved it without changing that test.
- `ruff check .`: passed.
- In `apps/web`, `npx tsc --noEmit`: passed.
- `KALL_UI_PORT=3320`, `npx playwright test --config playwright.usability.config.ts functional-areas.spec.ts`: **4 passed**, two cases each at 1440px desktop and 375px mobile. Uses synthetic local routes with no Clerk setup or backend proxy. Checks edits, failed-save persistence, pause/reactivate, reload, zero values and onboarding request payloads.
- Existing `e2e/profile-pause.spec.ts` also gains authenticated regression coverage, but was **not run** because the existing global setup performs remote Clerk cleanup.
- Opened and visually inspected generated desktop/mobile editor and onboarding screenshots plus the mobile saved profile. New labels, evidence help text, values, buttons and stacked layout fit without horizontal page overflow. Native select options and long single-line inputs scroll inside their controls. This is local component visual review, not production authentication, mobile-device, live-provider, or live-email verification.

Screenshots are local Playwright artifacts under `apps/web/test-results/functional-areas-*`, named `functional-area-editor-{desktop,mobile}.png`, `functional-area-profile-{desktop,mobile}.png`, and `functional-area-onboarding-{desktop,mobile}.png`. They are not committed build artifacts.

## Release boundaries

Root coordinates stacked integration with PR169 and monitoring. No CI check was bypassed or rerun by this lane. CI billing status may have changed while these tests ran; root owns current release verification. No cloud pilot was enabled. Unrelated inherited copyright edits and untracked files were preserved and left unstaged.

## Legacy digest safety follow-up

The pre-monitoring digest renderer trusted queued Opportunity IDs without checking the current profile. A narrow follow-up now checks Opportunity ownership, active profile ownership and current hard exclusions when rendering. A batch with no eligible rows is marked skipped without invoking a sender. Five black-box regressions cover an existing JobMatch excluded before delivery, both before and after score refresh, plus paused profiles and cross-user profile/Opportunity ownership. Final full offline run: **451 passed** with the same default SQLite environment above; Ruff also passed.

Monitoring already implements broader delivery-time eligibility, including preferences, score thresholds and suppression. During integration, its `eligible_opportunities` path should supersede this interim renderer and empty-batch handling. Keep `tests/test_digest_profile_eligibility.py`: it depends only on the public `process_delivery` behavior and not the interim exception or renderer internals. This follow-up does not change schedules, delivery modes or provider configuration.

The six visual review images were copied outside disposable test results to `C:\Users\James\.codex\visualizations\2026\08\30\01a054aa-8757-7a02-bf5d-061725f9efa7\functional-area-review\`, preserving the filenames listed above for root review. Main targeting commit is `2749395`; root integrated it as `3b34910`.
