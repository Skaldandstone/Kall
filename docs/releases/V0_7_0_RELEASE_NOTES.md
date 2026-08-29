# Kall v0.7.0

Kall v0.7 adds a scheduled opportunity-discovery and notification foundation.

## Included

- Daily, weekday, and weekly discovery schedules with overlap prevention.
- Configurable posting-age limits.
- Canonical opportunity deduplication across ATS sources.
- Material-change fingerprints so dismissed jobs only return when meaningfully changed.
- Opportunity inbox states: new, saved, reviewing, apply, not interested, and archived.
- Notification preferences, device registrations, delivery records, dedupe keys, and retry metadata.
- Daily-digest queue support.
- Growth-market signals derived from recurring job skills and requirements.
- A dark Nordic Opportunity Inbox web workspace.
- Ownership-protected APIs, migration, and tests.

Notification providers and the production scheduler remain adapter boundaries. Email and push credentials are required before real delivery is enabled.
