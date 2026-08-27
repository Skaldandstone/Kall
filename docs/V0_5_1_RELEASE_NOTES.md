# Kall v0.5.1 - Resume Intelligence Foundation

## Included

- Structured, versioned resume parsing records.
- Deterministic extraction of sections, skills, dates, metrics, and achievement candidates.
- Structured job-requirement analysis separating explicit requirements from inferred leadership signals.
- A user-owned achievement library with suggested, verified, and rejected states.
- Ownership checks on all resume and achievement intelligence endpoints.
- A Resume Intelligence web workspace for parsing resumes and verifying achievement candidates.
- Alembic migration and parser tests.

## Safety and factuality

- The deterministic parser does not generate new resume claims.
- Metrics are copied from source text and stored with source resume/parse identifiers.
- Achievement candidates remain `suggested` until explicitly verified by the user.
- Rejected achievements remain distinguishable and must not be used by future tailoring services.
- Job analysis stores explicit requirements separately from inferred signals.
- Sensitive EEO, work-authorization, reference, and privacy-controlled fields are not read by this pipeline.

## Next slice

Kall v0.5.2 will rank resumes for each job and score verified achievements against structured requirements. It will explain every selection and preserve a deterministic fallback when no AI provider is configured.
