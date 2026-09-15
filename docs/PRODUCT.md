# Kall MVP Product Scope

Plan copy and enforcement live in `apps/web/app/lib/plans.ts` and
`backend/kall/services/quota.py` -- this is a plain-language mirror of that,
kept in sync with it rather than a separate source of truth. See
`docs/UNIT_ECONOMICS.md` for the cost model the prices were chosen from.

**Pending, not yet built** (Linear SSE-206): repricing to Plus $9/mo,
Premium $25/mo, and Free's AI surface dropping to effectively zero. See
`docs/prd/00-product-vision.md`'s Business Model Baseline for the full
decision. Everything below is what's actually live today.

## Free ($0)
- Unlimited profile editing
- Resume library
- Search profiles
- Job matching
- Application tracking, tailoring, and job search all available -- the
  caps below bound cost, not which features exist
- 5 applications a week
- 3 AI actions a week
- 25 MB of resume storage

## Plus ($5/month)
- Everything in Free, plus:
- 25 applications a week
- 15 AI actions a week
- 500 MB of resume storage
- Daily brief and scheduled discovery
- Career page without the Kall footer
- The apply extension

## Premium ($15/month)
- Everything in Plus, plus:
- Unlimited applications
- 400 AI actions a month
- 5 GB of resume storage
- A career page per role
- Custom domain

## Career identity modules
- Personal/contact
- Websites and portfolios
- Career profiles
- Education
- Skills
- Languages and language certifications
- Certifications and expirations
- Security clearances
- Work authorization
- Awards and honors
- Publications
- Patents
- Speaking engagements
- Professional memberships
- Volunteer and board service
- References and contact permissions
- EEO
- Field-level privacy
