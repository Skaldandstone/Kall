# Kall identity and navigation review

Updated 31 August 2026. Status: **Inscription direction selected**. Detailed screen and navigation proposals remain under review. No production brand or routing changes.

[Open the corrected gallery](../../design/identity-exploration/revision-02/index.html) for three rune-aligned concepts, 12 desktop and 12 mobile candidate screens, and eight current-style control screens. [Round 02 notes](../../design/identity-exploration/revision-02/README.md) explain the source alignment, samples and limitations. [Round 01](../../design/identity-exploration/round-01.html) is preserved as a historical, unapproved archive.

## Recommendation and decision

The round 01 recommendation of **Edition is withdrawn** after feedback that the concepts lost Kall's carved-rune character. Round 02 follows the authoritative KHIG, product vision, existing mark construction and Notion Volume IV design foundation. All three candidates retain the crossing-stave rune, dark graphite/charcoal, warm text and muted fjord blue. Stave explores a precise grotesk system, Inscription a restrained cut-serif treatment, and Fjord an open humanist system.

James selected **Inscription** on 31 August 2026 by choosing the corrected raster board. This supersedes the prior Stave review reference. The [selection record](../../design/identity-exploration/revision-02/selection.md) identifies the exact image and decision scope. The existing rune, cut-serif wordmark character, charcoal stone and muted fjord blue carry forward. A separate source literally titled Runestone was not found; the correction follows the authoritative sources above and James's feedback.

Identity direction selection is complete. Production wordmark/type refinement and accessibility validation remain to be done. The broader page hierarchy still needs review before implementation. Current-flow polish and functional fixes can proceed independently. Do not copy these static studies into production as a shortcut around those decisions.

## Navigation storyboard

Retain the current five destinations: Brief, Opportunities, Applications, Documents, Career. Keep account settings outside the principal work sequence. Mobile retains labeled destinations rather than icon-only navigation.

| Moment | Person's question | Proposed view and next action | Preserved boundary |
| --- | --- | --- | --- |
| Arrive | How does my next step fit my career? | Brief leads with saved career strategy and the professional record, then opportunities and a prepared review. Empty state offers Search now and Create a career profile as peer actions. | Search never requires profile creation first. No fabricated activity in empty states. Career support extends beyond an active job search. |
| Search directly | What is out there? | Opportunities opens to manual search; a pasted or selected job can proceed to preparation. | Wider web search remains manual. Carry external URL, title and snippet without submitting. |
| Define direction | What kind of work do I want? | Career Strategy exposes target titles, functional areas, locations, industry and exclusions. | Unrelated edits and pause/reactivate preserve criteria. Expanded targeting stays deterministic. |
| Understand a posting | Why does this fit? | Selected Opportunity pairs posting facts with Job Intelligence evidence, gaps and a visible single functional-area bonus. | Job fit is not career development and not an offer prediction. Missing area evidence causes no penalty. |
| Monitor | Is the search still working? | Opportunities Monitoring displays sources, last successful check, next check and delayed/unconfigured state. | Opt-in pilot limits, configuration truth and notification consent remain enforced. No promise of inbox arrival. |
| Prepare | What can I say honestly? | Application workspace carries job and strategy into document preparation, with source evidence and version history. | Existing records and workflow stages are preserved. Generated claims require review. |
| Review | Is every detail right? | Desktop pairs document and confirmation panel. Mobile stacks document before confirmations. | Sensitive-field confirmation and explicit approval remain required. |
| Submit | Am I ready to send this? | A separate deliberate action follows valid approval and existing submission checks. | The exploration does not implement or change submission behavior. |
| Develop | What can I build toward? | Career Growth presents development plans, milestones and resources. | Growth remains separate from Job Intelligence. |
| Return | Where did I leave off? | Brief links back to the saved application or active strategy. | Preserve IDs, versions, user ownership and recorded status. |

Documents remains a durable library. Resume Intelligence, tailoring and generation retain their purposes, while entry points from a job or application reduce context switching. The exploration does not combine those operations or create a new service.

## Page-by-page migration mapping

The inventory below was checked against the 40 `apps/web/app/**/page.tsx` files at base `b05cdcf`. It is a presentation proposal. Keep every current URL, query parameter, tab key, dynamic ID and access rule working. No data rewrite is part of the design migration.

| Current route | Proposed presentation | Compatibility requirement |
| --- | --- | --- |
| `/` | Public entry with Search now and Create a career profile. | Preserve current public entry and auth boundaries. |
| `/dashboard` | Welcome/return overview using selected identity. | Keep route; do not require profile completion to search. |
| `/morning-brief` | Focused Brief from the screen studies. | Morning Brief delivery remains separate from opportunity alerts. |
| `/search` | Opportunities workspace; manual search remains immediately available. | Preserve `tab=search`, `tab=discovery`, `tab=sources` and existing filter state. |
| `/opportunities` | Existing entry into discovered opportunities. | Preserve current redirect to `/search?tab=discovery`. |
| `/jobs` | Existing discovered-jobs entry. | Preserve current redirect to `/search?tab=discovery`. |
| `/sources` | Source management within Opportunities. | Preserve current redirect to `/search?tab=sources`. |
| `/job-intelligence` | Standalone posting-fit view and contextual opportunity panel. | Keep `job` and `profile` query parameters and selected evidence. |
| `/profiles` | Career with Strategy first and clear secondary tabs. | Keep `strategy`, `employment`, `record`, `growth`, `achievements`, `references`, and legacy identity handling. |
| `/profile` | Existing profile compatibility entry with selected shell. | Preserve existing purpose and stored data; do not repurpose identity fields. |
| `/profile-details` | Professional record entry. | Preserve redirect to `/profiles?tab=record`. |
| `/growth` | Development planning in Career. | Preserve redirect to `/profiles?tab=growth`; do not merge with posting-fit analysis. |
| `/intelligence` | Achievements entry with unambiguous labeling. | Preserve redirect to `/profiles?tab=achievements`. |
| `/testimonials` | References and testimonials under Career. | Preserve redirect to `/profiles?tab=references`. |
| `/testimonial-submit` | Public testimonial contribution with clear context. | Keep token/link semantics, privacy and approval requirements. |
| `/resumes` | Documents library and version history. | Keep `library`, `intelligence`, `tailoring`, `generate` tab keys. |
| `/documents` | Document generation entry. | Preserve redirect to `/resumes?tab=generate`. |
| `/resume-intelligence` | Resume analysis entry. | Preserve redirect to `/resumes?tab=intelligence`. |
| `/tailoring` | Job-specific document tailoring entry. | Preserve redirect to `/resumes?tab=tailoring`, versions and source evidence. |
| `/applications` | Application pipeline and next actions. | Preserve stages, filters, IDs, owner isolation and existing records. |
| `/applications/new` | Job-context preparation workspace. | Preserve `job`, `profile`, `external_url`, `title`, `snippet` query inputs. |
| `/applications/[id]` | Persistent application workspace. | Preserve dynamic ID, ownership, document versions and workflow state. |
| `/apply` | Existing assisted application entry. | Keep current behavior and deep links; no new submission capability. |
| `/application-review` | Review screen with evidence and confirmation sequence. | Retain required confirmations, approvals and state checks. A visual refresh must not invalidate or silently grant approval. |
| `/submissions` | Submission history and existing controls. | Keep separate submission action and existing safeguards. |
| `/settings` | Account and product settings. | Preserve endpoint behavior and access controls. |
| `/settings/identity` | Clearly separate private identity details. | Preserve `/profiles?tab=identity` compatibility and sensitive-data boundaries. |
| `/settings/notifications` | Delivery modes, timing, quiet hours and configuration status. | Digest remains default; immediate is an explicit preference. Reflect unconfigured sending honestly. |
| `/settings/career-page` | Public-page visibility and preview. | Preserve opt-in publication, slug and field visibility controls. |
| `/p/[slug]` | Public career page with approved tokens only after selection. | Preserve public URL, visibility and approved content. Never expose private identity by restyling. |
| `/privacy` | Privacy controls with clear consequences. | Preserve permissions and action safeguards. |
| `/privacy-policy` | Legible legal content. | Typography only; no change to legal meaning. |
| `/billing` | Existing billing interface. | Subscription prices, plan terms and payment behavior unchanged. |
| `/account/[[...rest]]` | Existing account management surface. | Preserve Clerk integration and catch-all routes; no production Clerk migration. |
| `/sign-in/[[...sign-in]]` | Consistent sign-in presentation. | Preserve authentication, return destinations and security behavior. |
| `/sign-up/[[...sign-up]]` | Consistent sign-up presentation. | Preserve authentication and consent behavior. |
| `/onboarding` | Clear optional progression with retained form values. | Preserve both entry paths and existing persisted values. |
| `/setup` | Existing setup flow, clearer next actions. | Preserve setup logic and user choices. |
| `/demo/[module]` | Selected identity with explicit sample-data labels. | Preserve demo isolation and no real submission. |
| `/admin` | Dense, legible operational interface. | Preserve admin authorization. No new privileges or public links. |

## Migration sequence after selection

1. Preserve the existing rune geometry as the anchor. After selection, refine the wordmark and approve small-size, reversed and monochrome usage. Any change to the rune itself requires a separate explicit review. Check font licensing and a production token sheet. Keep current brand assets for rollback.
2. Introduce scoped presentation tokens behind a reversible UI flag. First apply the shell and Brief, preserving link targets. Test keyboard focus, contrast, reduced motion, 200% zoom and 375px touch layouts.
3. Apply Opportunities and contextual Job Intelligence. Test existing search/discovery tabs, filters, saved workflow states and source status. The monitoring lane owns live data and delivery correctness.
4. Apply Career and Documents. Validate all tab and redirect entry points, persistent form values, exclusion preservation, record permissions and resume version/download behavior.
5. Apply Applications and review last among core flows. Repeat ownership, sensitive-field confirmation, approval and submission guard tests before rollout. Typography must not hide a warning or move consent into a default state.
6. Apply public career pages, account/auth, billing, legal, demo and admin presentation in separate small changes. Do not combine these changes with auth migration, pricing changes or application automation.

Each stage requires actual browser visual review at desktop and 375px, plus relevant functional checks. Screenshot completion is not user approval. The static studies are not a production component library or an accessibility certification.

## Lane evidence and integration

The exploration was implemented only in `design/identity-exploration/` and this file. The gallery, sources and images are standalone. Inherited unrelated copyright edits and untracked files were preserved. No cloud deployment, live email, new external service or runtime dependency was introduced.

The [round 02 QA log](../../design/identity-exploration/revision-02/qa.md) records inspected assets, actual browser checks and limitations. The coordinator reports PR #169 run `33339187268` passed all five required jobs and the earlier runner-start payment/spending restriction did not recur. Draft PR #170 has its own CI, whose current state must be checked there. This lane did not bypass checks or change billing. Inscription is selected; detailed screen and hierarchy review remain user decisions; they do not block independent functional repairs.
