# Kall v0.5.4 - Document Studio

Kall v0.5.4 turns finalized, evidence-reviewed tailoring proposals into private application documents.

## Added

- Versioned generated-document, artifact, keyword-coverage, cover-letter, and audit models.
- ATS-safe DOCX, PDF, and plain-text resume generation.
- Authenticated document detail and download endpoints.
- SHA-256 checksums for canonical content and each generated artifact.
- Required and preferred keyword-coverage reports that preserve unsupported gaps.
- Grounded cover-letter proposals using finalized resume evidence and user-supplied company-interest notes.
- Paragraph-level cover-letter accept, edit, reject, and finalization workflows.
- Dark Nordic Document Studio UI aligned with the merged web foundation from PR #6.
- Alembic migration and document readability tests.

## Safety

- Resume generation requires a finalized tailoring proposal.
- Only accepted changes and approved user edits enter generated resumes.
- Rejected changes are omitted.
- Unsupported requirements remain visible and are not inserted to improve keyword scores.
- Downloads require authenticated ownership.
- Generated files are private by default and stored behind an artifact abstraction.
- Cover-letter sentences retain evidence references and require review before finalization.

## Frontend synchronization

Before implementation, the repository was rescanned and the merged dark Nordic frontend was identified as newer than v0.5.3. The Document Studio uses the current design tokens, cards, navigation, responsive grids, accessibility focus states, and reduced-motion behavior rather than restoring the earlier light interface.
