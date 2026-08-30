# Current-flow usability implementation

Branch: `codex/kall-user-flow-polish`, based on `b05cdcf`.

This lane keeps the current identity and navigation destinations. It changes no authentication, billing, subscription, application submission transport, or production deployment configuration. Shared copyright edits and untracked files were left unstaged.

## Findings and repairs

| Classification | Before | After |
| --- | --- | --- |
| Confirmed defect | Mobile primary navigation clipped destinations behind horizontal scrolling. | Links wrap visibly and retain a minimum 44px target height. All existing deep links remain. |
| Confirmed defect | ToastHost hid every inline alert, including retry controls, and left only a temporary toast. | Inline alerts stay visible. Alerts containing controls are not duplicated as toasts. A weak map prevents unchanged inline messages from repeatedly generating toasts. |
| Confirmed defect | An optional profile selector chose the first profile on load, replacing saved search state. | Searching without a profile remains a valid initial choice. Saved query URLs retain their contents. Profile-load failures have a retry action. |
| Confirmed defect | Rebuilding generated searches parsed parenthetical groups only and dropped trailing exclusions. | Query parsing preserves quoted phrases, single terms, site restrictions and trailing negative terms. |
| Confirmed defect | Changing an application profile refetched options and could overwrite a manual resume selection. | Options load independently of selection changes. A deliberate profile change selects its configured resume; subsequent manual resume choices persist. |
| Confirmed defect | Options service failures appeared as an empty profile/resume collection. | Failure and empty states are distinct, with retry, profile creation, upload and search links. |
| Confirmed defect | An application result could remain visible after preparation choices changed. | Changing choices invalidates the displayed result. Choices are locked during preparation and retained after failure. |
| Confirmed defect | A failed or unfinished review load could display a completed readiness message and enabled approval controls. | Loading, unavailable and ready states are explicit. Review actions remain disabled until data is ready. Failed saves retain edited text and release the busy state. |
| Confirmed defect | Long application answers were displayed in a single-line input. | A labeled, vertically resizable answer field makes the full text available for review before acceptance. |
| Confirmed defect | Brief's “Save for later” navigated without saving. Brief errors offered no in-place recovery. | The link truthfully opens tracked opportunities. Errors offer retry and direct search/profile entry paths. |
| Confirmed defect | Oversized application headings overflowed at 375px; search headings pushed controls far below the first screen. | Scoped current-flow heading sizes and shorter headings preserve the existing fonts while improving mobile fit and access to actions. |
| Confirmed defect | Career form values used undefined `--text-primary`, inheriting dim label colors. | Existing `--text` and `--text-secondary` roles make entered values, labels and guidance legible. No palette tokens or field structure changed. |
| Intended behavior | Search and profile creation are separate entry paths. Job Intelligence concerns posting fit; Growth concerns career development. | Preserved. No navigation migration or brand replacement was performed. |
| Separately scoped | Live Google results, Clerk sessions, production API persistence, generated documents, submission transports and new identity directions. | Not claimed as verified by this fixture run. Integration and identity lanes own their respective follow-up work. |

## Isolated browser harness

`apps/web/usability-fixture` is a separate local Next app that imports real production components and CSS. It has synthetic same-origin API responses, no production middleware, no Clerk provider, no backend forwarding and no sender. Unconfigured mutations return 501. Its content security policy blocks external script, connection, frame and form destinations; Playwright also blocks external requests. Public font downloads occur during Next compilation, as in the existing app.

From `apps/web`:

```powershell
$env:KALL_UI_PORT = '3310'
npx playwright test --config playwright.usability.config.ts
```

The config does not import real-auth global setup or cleanup. Targeting can use `KALL_UI_PORT=3320`; each lane overrides API fixtures with `page.route`. API port 8310 is unused. Do not use these tests as proof of Clerk or backend integration.

Capture reproducible visual evidence separately:

```powershell
$env:KALL_UI_SCREENSHOTS = '1'
npx playwright test --config playwright.usability.config.ts screenshots.spec.ts
```

The capture spec waits for loaded UI, `document.fonts.ready`, and records viewport widths and font status. Captures are true PNG files at 1440px desktop and 375px mobile. The final images were inspected, not approved merely because the capture test completed. Earlier in-app captures trimmed scrollbars and one resize produced a broken search image; those captures were replaced. The retained before image is accurately named JPEG.

## Visual review evidence

| Flow | Desktop | Mobile |
| --- | --- | --- |
| Dashboard entry paths | [Desktop](usability-screenshots/dashboard-desktop.png) | [375px](usability-screenshots/dashboard-mobile.png) |
| Morning Brief | [Desktop](usability-screenshots/brief-desktop.png) | [375px](usability-screenshots/brief-mobile.png) |
| Search | [Desktop](usability-screenshots/search-desktop.png) | [375px](usability-screenshots/search-mobile.png) |
| Application preparation | [Desktop](usability-screenshots/preparation-desktop.png) | [375px](usability-screenshots/preparation-mobile.png) |
| Application review | [Desktop](usability-screenshots/review-desktop.png) | [375px](usability-screenshots/review-mobile.png) |
| Career form contrast | [Desktop](usability-screenshots/profile-edit-desktop.png) | [375px](usability-screenshots/profile-edit-mobile.png) |

[Before: application heading overflow](usability-screenshots/preparation-mobile-before.jpg). The viewport was 375px; overflowing content widened that before capture.

Recorded capture measurements: [desktop](usability-screenshots/measurements-desktop.json) and [mobile](usability-screenshots/measurements-mobile.json). Unused language subsets may remain unloaded; the records distinguish those from the loaded Syne, Epilogue and IBM Plex Mono faces used in these screens.

Scope of visual review: navigation visibility, heading wrapping, control contrast, card alignment, button reachability, empty search messaging and preparation/review safeguards. Brief intentionally uses the existing body-family heading styling, while dashboard, search and preparation use the existing display family. The career screenshots show this lane's base form, not the targeting lane's additional functional-area controls.

## Validation and release boundaries

- Verified 2026-08-30: final combined run passed all 28 cases in 4.7 minutes. The earlier cumulative screenshot timeout was resolved by giving the six-page capture test its own 90-second limit; individual loaded-state assertions were unchanged.
- TypeScript: `npx tsc --noEmit` passed on the final source.
- Fixture behavior suite: 26 desktop/mobile cases covering query reconstruction, saved query preservation, failed search, keyboard search, navigation targets, preparation selection persistence, retry/empty states, request locking, failed review loads/saves, Brief recovery and horizontal overflow.
- Visual capture suite: two viewport runs producing twelve screenshots plus recorded layout/font measurements.
- Real-auth E2E setup was not run during the parallel build. No shared Clerk identities were created, swept or deleted by this lane.
- No backend or live provider behavior is claimed. Required GitHub CI remains a release gate; the reported payment/spending blocker was not bypassed or repeatedly retried.
- Integration should cherry-pick the usability commit onto the coordination branch. Shared files to check are `globals.css`, `profiles/page.module.css`, `ToastHost.tsx`, `ProfessionalProfileSelect.tsx`, `AppNav.module.css` and the import/class/heading-only change in `search/page.tsx`. No StrategyTab, onboarding, DiscoveryTab or NotificationSettings implementation changes are included.
