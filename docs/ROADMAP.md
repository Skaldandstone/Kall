# Roadmap

The next milestone after v0.3 is complete onboarding and CRUD for identity, professional history, credentials, EEO, work authorization, references, and field-level privacy controls.

## Competitive gaps (2026-08-27)

Found by comparing Kall against Simplify.jobs, Teal, Huntr, Jobscan, and Final Round AI. Ranked by expected impact; none are started.

**1. Save any job from any site into the Opportunity inbox.** Kall's discovery is entirely push-based -- structured ATS providers plus a search-query builder -- with no way to capture a job while browsing LinkedIn, Indeed, Glassdoor, or a random company careers page. This is the single most-cited feature across every competitor researched (Simplify, Teal, Huntr all lead with it) and the biggest real gap. Needs: a content script with broad host permissions (currently `apps/extension/manifest.json` only grants Kall's own domain), a page-scraping heuristic per major job board (title/company/location/description), and a "Save to Kall" action that posts into the existing `Opportunity`/`Job` model via `upsert_opportunity` (`services/opportunities.py`) -- the storage side already exists, only the capture side is missing.

**2. Networking / referral contact tracking.** No `Contact` or `Referral` model exists anywhere in the schema. Teal's Job Search CRM and dedicated tools like FindWarmIntros track people (recruiters, alumni, warm intros) per company and prompt follow-ups. Scope: a `Contact` model (name, company, relationship, last-contacted, notes), linked optionally to a `Job`/`Opportunity`, with a simple list/reminder UI -- no LinkedIn-scraping "find warm intros" automation needed for a first cut.

**3. Interview prep.** The pipeline already has an "interview" stage (`ApplicationStatus`) but nothing helps someone prepare for it -- no question bank, no mock interview, no notes-per-interview. Final Round AI's entire business is this. Smallest reasonable first cut: a question bank scoped by job title/company plus a place to jot prep notes against a specific application; AI mock interview (voice/chat practice) is a larger follow-on, not part of a first pass.

**4. Resume proofreading, independent of any specific job.** `_resume_score` (`api_resume_intelligence.py`) only checks metadata completeness (has text, tags, target titles) -- it doesn't catch a typo, a repeated phrase, or an ATS-breaking layout (tables, columns, graphics) the way Huntr's resume checker does. Smaller and more self-contained than the other three; a reasonable one-off to slot in whenever there's a light afternoon.

Not chasing: bulk/volume auto-apply (LazyApply, FastApply-style spray-and-pray). 2026 data cited by Huntr shows this converts far worse than a quality-focused approach, and it's the opposite of Kall's mandatory-review-before-submit philosophy.
