# Kall v0.4

Kall v0.4 completes the first end-to-end career identity experience.

## Added

- Persistent guided onboarding state and application-readiness scoring.
- CRUD APIs for education, skills, languages, certifications, clearances, awards, publications, patents, speaking, memberships, volunteer/board service, and references.
- Encrypted EEO and work-authorization upserts.
- Field-level privacy rules for private, tailoring, autofill, and public-profile use.
- Enforcement preventing sensitive EEO, authorization, and reference fields from being public.
- Resume version creation from an existing Resume Studio document.
- Responsive setup, profile-record, and privacy web workspaces.
- Alembic migration and profile/privacy tests.

## Safety

Sensitive profile values remain encrypted. EEO and work-authorization records always require confirmation, and sensitive field families cannot be assigned to public-profile scope.
