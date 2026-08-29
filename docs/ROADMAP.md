# Roadmap

This file is the working log of competitive-gap work and near-term priorities. The milestone-level product roadmap (Alpha, MVP, Beta, Post-MVP) lives in [`prd/02-roadmap.md`](prd/02-roadmap.md).

The next milestone after v0.3 is complete onboarding and CRUD for identity, professional history, credentials, EEO, work authorization, references, and field-level privacy controls.

## Competitive gaps (2026-08-27) -- all four shipped 2026-08-28

Found by comparing Kall against Simplify.jobs, Teal, Huntr, Jobscan, and Final Round AI. Ranked by expected impact.

**1. Save any job from any site into the Opportunity inbox -- done ([#137](https://github.com/Grunklegrok/Kall/pull/137)).** Kall's discovery was entirely push-based -- structured ATS providers plus a search-query builder -- with no way to capture a job while browsing LinkedIn, Indeed, Glassdoor, or a random company careers page, despite this being the single most-cited feature across every competitor researched. `content.js`'s `scrapeJob()` reads schema.org `JobPosting` structured data (common across most job boards) with a page-title/meta-description fallback; a new "Save this job" button in the popup posts it to `POST /jobs/capture`, which reuses the existing `Job`/`Opportunity` storage and `deterministic_match` scoring. No new host permissions needed -- rides the same on-demand content-script injection the fill flow already used.

**2. Networking / referral contact tracking -- done ([#138](https://github.com/Grunklegrok/Kall/pull/138)).** A new `Contact` model (name, company, relationship, last-contacted, notes), distinct from `Reference` (which has agreed to be contacted and feeds the testimonial flow). Rides the existing generic profile-resource CRUD (`profile_api.py`'s `RESOURCE_MODELS`) rather than a bespoke endpoint -- no LinkedIn-scraping automation, as scoped.

**3. Interview prep -- done ([#139](https://github.com/Grunklegrok/Kall/pull/139)).** Correction found while building this: `ApplicationStatus` never actually had an "interview" stage -- an interview can happen any time after submission, so `InterviewPrep` is scoped to a single application instead. An AI-generated question bank (job title/company/requirements, via the shared `ask_for_json` helper) falls back to a fixed general list with no AI key configured, plus free-text notes. Mock-interview practice (Final Round AI's whole business) remains a larger follow-on, not built.

**4. Resume proofreading, independent of any specific job -- done ([#140](https://github.com/Grunklegrok/Kall/pull/140)).** Not a spelling checker (no dictionary, no network dependency added) -- catches a duplicated line (accidental copy-paste) and long unspaced text runs (the signature a multi-column PDF layout leaves once merged, the same failure that breaks an ATS parser), folded into `_resume_score`'s existing `gaps` list.

Not chasing: bulk/volume auto-apply (LazyApply, FastApply-style spray-and-pray). 2026 data cited by Huntr shows this converts far worse than a quality-focused approach, and it's the opposite of Kall's mandatory-review-before-submit philosophy.

## Competitive gaps, round two (2026-08-28)

Compared Kall against Wellfound (AngelList Talent), LinkedIn Premium Career, and Levels.fyi/Glassdoor. Most of what those offer needs either paid market data (salary/comp benchmarking), a marketplace dynamic (LinkedIn's applicant-volume signals, InMail), or paid human labor (Levels.fyi's negotiation coaches) -- none buildable in-house without a data or business-model change, so not pursuing them. One gap was buildable and is done:

**Equity preference -- done ([#143](https://github.com/Grunklegrok/Kall/pull/143)).** `CareerProfile.equity_preference` existed on the model (inspired by Wellfound's "see equity upfront") but was missing from `CareerProfileUpdate` and the `GET /me/career-profiles` response entirely -- it could never actually be set or read back through the API, let alone shown in the UI. Added to both, exposed as a select in the profile editor, and wired into `deterministic_match` as a text-mention signal (`mentions_equity`) against the job description -- the same kind of soft, substring-based signal `salary_from_text` already uses for compensation.
