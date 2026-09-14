# Architecture

## Product surfaces

- Web: Next.js
- Mobile: React Native/Expo
- Desktop: Tauri wrapper
- API: FastAPI
- Data: SQLModel; SQLite for local MVP and PostgreSQL for hosted production
- Billing: Stripe Checkout and Billing
- Push: Expo device-token relay to FCM and APNs
- AI: optional OpenAI provider behind service boundaries

All customer-facing generated material follows the product-owned runtime,
validation, evidence, review, and fallback contract in
[Generated content in Kall](GENERATED_CONTENT.md).

## Sensitive information

EEO answers, disability status, veteran status, race/ethnicity, gender identity,
citizenship, visa and security-clearance sponsor information are sensitive.

Controls:
1. Encrypt stored values.
2. Default privacy to private.
3. Require explicit per-field scopes.
4. Require confirmation before use in an application.
5. Never publish sensitive fields to a public career site.
6. Keep audit records of approval and submission.

## Application workflow

discovered -> preparing -> review_required -> approved -> submitted

`approved` must record the user's explicit action. Providers may submit only approved
applications and only where automation is permitted.

## Public recruiter profile (later enhancement)

Generate recruiter-searchable career pages from fields explicitly scoped to
`public_profile`. Support custom domains, robots controls, contact forms, and profile
analytics. Never expose EEO, work authorization details, references, private contact
details, or clearance sponsor information.
