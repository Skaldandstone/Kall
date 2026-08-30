# Identity review evidence

30 August 2026. Status: **candidate_not_approved**. These are local visual studies. Nothing in this log certifies the production application or records user approval.

## Visual inspection

All three final raster boards were opened at generation or through the image viewer. Each of the 32 exported screen images was opened as browser screenshot output and visually inspected: 12 candidate desktop, 12 candidate mobile, four current-style desktop and four current-style mobile. The gallery was inspected at desktop and 375px widths. No blank or broken final image was accepted as a deliverable.

| Set | Brief | Opportunities | Career | Application review |
| --- | --- | --- | --- | --- |
| Edition desktop | Inspected | Inspected | Inspected | Inspected |
| Edition mobile | Inspected, spacing corrected | Inspected | Inspected, spacing corrected | Inspected, capture corrected |
| Vector desktop | Inspected | Inspected | Inspected | Inspected |
| Vector mobile | Inspected | Inspected | Inspected | Inspected |
| Horizon desktop | Inspected | Inspected | Inspected | Inspected |
| Horizon mobile | Inspected | Inspected | Inspected | Inspected |
| Current control desktop | Inspected | Inspected, capture extended | Inspected | Inspected |
| Current control mobile | Inspected | Inspected | Inspected | Inspected |

Corrections made during visual review:

- Vector's initial raster mark read as Z. The image tool corrected it to an architectural K and removed invented contact details. Only the corrected board is delivered.
- Hiding desktop line breaks on mobile joined words in the Brief and Growth headings. Added explicit spaces and re-rendered the affected mobile studies.
- A browser full-page capture repeated a top strip at a stitched boundary. All delivered screen images use single-frame canvas captures instead.
- The first mobile review capture clipped the footer/navigation. Reduced excessive vertical spacing in the review flow and recaptured the complete screen. Sensitive-field confirmation, disabled approval and separate-submission text remain visible.
- The current-style desktop Opportunities view needed 1320px of height to include its footer, rather than the 1280px used by the other desktop studies.

The root coordinator independently inspected Edition and Horizon boards, the complete Edition mobile review, and the gallery. Their reported checks covered direction/screen/device selection, full-resolution links, Vector/Application review/Mobile and the current-style control. They agreed Edition was the strongest recommendation while keeping it explicitly unapproved.

## Browser and structural checks

The static mockups were checked in the Codex in-app browser at 1440 × 1024 and 375 × 900. The recorded matrix in `browser-checks.json` checks 16 combinations at each size for page-level horizontal overflow and identical normalized main-content text across the four themes. Application review also records the disabled approval button. The mobile Career secondary tab strip is intentionally horizontally scrollable within its container; the page itself does not overflow.

Gallery interaction verified: selecting Horizon, Application review and Mobile updates the displayed label, JPEG source and full-resolution target; the loaded image is 375px wide. Gallery inspection at 375 × 900 found no page-level horizontal overflow. Root independently repeated comparison checks with other selections. Normal links and buttons remain keyboard focusable with explicit focus styles. This is not a full screen-reader or keyboard-navigation certification.

`node --check mockup.js` verifies JavaScript syntax. `python validate_package.py` verifies all 35 raster files, expected dimensions, unique hashes, complete screen inventory, required source/docs, unchanged copied Bindrune and the recorded browser matrix. It writes `manifest.json`. Raster validation and DOM checks are separate from the visual inspections above.

A larger browser-check batch timed out and reset its session. It was rerun in smaller batches with incremental evidence writes. The failed batch is not counted as completed verification.

## Scope and limitations

- No backend tests, production build or production browser suite is claimed. The lane changes only static artifacts and its self-contained documentation.
- No production sender, monitoring worker, profile API, application approval or submission implementation is exercised. All data and statuses are synthetic. The preview makes no API calls and mutating controls are inert.
- Current style is a reconstruction with the unchanged Bindrune asset and current color tokens. It uses local font fallbacks, not a screenshot of the live app.
- The generated board prose and marks remain exploratory. Live-text wordmarks are stand-ins, not approved vector masters.
- Detailed document previews use small typography to show the whole resume. A production document viewer still needs zoom/download, accessible document reading, real device testing and a full accessibility pass. These mockups are not an accessibility certification.
- Font licensing, trademark clearance, final mark geometry, contrast testing across every state, 200% zoom and broader responsive behavior remain post-selection work.
- GitHub required CI was not bypassed or repeatedly rerun by this lane. The coordinator reports PR #169 run `33339187268` passed all five required jobs; the earlier runner-start payment/spending restriction did not recur. Combined integration has separate CI pending. No billing change was made.
- Local server port 4319 is left available for review. No cloud deployment or new recurring service was created.

The final inventory caught that browser screenshot bytes were JPEG despite the initially chosen PNG filenames. All 32 captures were renamed to `.jpg`, with gallery links updated. Bytes were preserved without recompression, and the validator now checks actual format against extension.
