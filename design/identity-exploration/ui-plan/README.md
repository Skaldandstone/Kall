# Kall all-pages UI plan

31 August 2026. **Inscription is selected. This UI plan remains a proposal.**

Open [the interactive plan](index.html) or <http://127.0.0.1:4319/ui-plan/>. The left-hand list covers every one of the 40 existing web routes. Choose a page to see its proposed screen, purpose, primary action, mobile behavior, empty state and compatibility requirements. Desktop/mobile controls adjust the embedded study. “Open full-page study” opens the responsive page independently. The state selector shows normal, empty, loading, error, denied and success specimens.

These are authored responsive HTML screen proposals, not production components or a finished component library. The selected raster board is included as the identity reference. The carved rune uses the existing geometry; Georgia and Arial are local type substitutes pending production wordmark/font refinement. No new identity selection is needed.

## Proposed hierarchy

| Main destination | Pages and subordinate views |
| --- | --- |
| Brief | Career direction, professional-record context, useful opportunities and a prepared review. |
| Opportunities | Manual Search, Tracked opportunities, Sources, and contextual/standalone Job Intelligence. Monitoring status belongs with sources and the active strategy, not a sixth main destination. |
| Applications | Pipeline, preparation, application detail, document review, questions, approval and separate submission. |
| Documents | Library, Resume Intelligence, Tailoring and Generate. Versions and source facts remain attached. |
| Career | Strategy, Work history, Professional record, Growth, Achievements and References. |
| Settings, outside the five primary destinations | Identity/contact, account security, notifications, public career-page controls, privacy and billing. |
| Public/support surfaces | Public home, public career page, reference invitation, policy, authentication, demos and authorized support. |

Keep both entry paths: search immediately or create a career profile. The signed-in welcome page and the Brief have distinct purposes: welcome offers entry choices, while Brief supports a returning person’s career context. Job Intelligence remains posting fit; Growth remains career development. No networking feature or additional service is implied.

## Existing routes and aliases

The [coverage inventory](coverage.json) compares the plan against all `apps/web/app/**/page.tsx` files in this worktree. Each URL is represented once, including compatibility entries. Fifteen existing redirect routes reuse their destination’s UI instead of acquiring duplicate pages.

The source audit corrected several earlier broad descriptions in the migration storyboard:

- `/profile` redirects to `/settings/identity`.
- `/setup` redirects to `/profiles`.
- `/apply` redirects to `/applications/new` with the existing query string.
- `/application-review` and `/submissions` both redirect to `/applications`. Actual review is inside `/applications/[id]`; the prototype does not create a second approval endpoint.

The existing Career and Documents tab keys remain intact, including the legacy identity-tab redirect. The preview includes all six Career tab views, all four Documents views and the three Opportunities views. The page list groups URL aliases by purpose, while the screen preview represents the canonical destination. Public pages keep public access boundaries; support remains authorized-only.

## Interaction and state contract

Every route record includes its primary question/action, composition, mobile plan, empty state and a preserved behavior. Shared loading/error/denied/success specimens demonstrate the presentation contract. They are not claims that an endpoint implements those states. Relevant destructive flows retain explicit confirmations, with account deletion separated from normal settings and application approval disabled while sensitive fields are outstanding.

Forms show fictional Alex Morgan / quality-engineering content. Inputs are read-only study fields; mutation controls display a local preview notice or remain disabled. The prototype does not accept credentials, files, sensitive profile data or payment details. It makes no API calls, sends nothing, and does not persist changes. Links stay within the local studies unless explicitly opening a package reference.

Plan prices, terms, auth providers, permission behavior, submission behavior and production resource configuration remain unchanged. The monitoring screens illustrate the approved opt-in pilot boundaries and truthful unconfigured-sender status; they do not certify a running pilot. Legal content is a layout placeholder, not a replacement policy.

## Validation and limits

Run `node design/identity-exploration/ui-plan/validate_plan.cjs` from the repository root. It checks exact 40-route coverage, unique page IDs, preserved redirect destinations, required per-page metadata, JavaScript parsing and evaluation of each default HTML template. It writes `coverage.json`. It does not launch or emulate a browser.

The browser connection was established for review, but navigation initially failed because the local server had stopped. After the server was restarted, the browser blocked automated reopening under its URL policy. No alternate browser or indirect browser execution was used to circumvent that block. **The new page studies have not received browser visual approval.** Existing Inscription board and round-two screenshots retain their earlier visual-review evidence; that evidence does not extend to these new layouts.

The plan is still useful for page coverage and flow review. Before implementation, visually inspect the new studies at desktop and 375px, check keyboard focus, zoom and screen-reader behavior, and refine type/spacing. No production CSS, brand assets or routes were edited. User approval of this page hierarchy remains separate from the completed identity selection.

## Release order

1. Refine Inscription wordmark/type and accessible tokens, retaining rune geometry.
2. Apply the shell, entry choices and career-first Brief behind a reversible presentation change.
3. Apply Opportunities and Career while testing criteria preservation, fit explanations and source status.
4. Apply Documents and Applications with version, ownership, workflow and approval/submission tests.
5. Apply settings/public/support presentation without mixing in pricing, auth or permission changes.

Keep all current deep links throughout. Each stage needs actual browser/visual review plus its relevant functional checks. Implementation is outside this artifact-only change.
