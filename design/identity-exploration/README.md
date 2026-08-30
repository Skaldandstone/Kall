# Kall identity exploration

Status: **candidate_not_approved**. Prepared 30 August 2026 on `codex/kall-identity-exploration`, based on `b05cdcf062533cbe2669cc836e5807c79788f7a0`.

Open [the review gallery](index.html). It includes three raster concept boards, 24 candidate screen JPEGs, eight current-style control JPEGs, a recommendation, and a navigation storyboard. All assets are local. Nothing here changes the live product.

To serve the package from the repository root in PowerShell:

```powershell
python -m http.server 4319 --bind 127.0.0.1 --directory design/identity-exploration
```

Then open <http://127.0.0.1:4319/>. The gallery also works as a local file. Its controls choose a direction, screen and device. The full-resolution link opens each JPEG without scaling it into a gallery column. The interactive study has live text and navigation between the four sample pages. Mutating actions only show a preview notice.

## Decision package

**Recommendation: Edition.** Its editorial type, tactile material and warm restrained palette make Kall feel personal without making it whimsical. It supports the relationship between a person's career record and their next decision. Serif display should remain selective; forms, evidence and dense text stay in a clear sans-serif.

| Direction | Distinctive idea | UI study typography | Palette | Main consideration |
| --- | --- | --- | --- | --- |
| Edition | Career as an evolving body of work; folded paper and a book-spine K study | Georgia display, Arial controls, Consolas annotations | Paper `#F5F2EC`, ink `#202422`, vermilion `#C34D35`, stone `#D4CCC0` | Display type needs restraint on dense screens. UI action red is darkened to `#A73B26`. |
| Vector | A deliberate sequence of decisions; architectural K and brushed metal | Bahnschrift display with Arial fallback, Arial controls, Consolas annotations | Plum `#211F2C`, lilac `#ECEAF4`, chartreuse `#D8EC82`, gray | Can feel technical; balance its precision with calm language and personal context. |
| Horizon | Space to see the next move; curved K and ceramic ribbons | Segoe UI with Arial fallback, Consolas annotations | White `#FCFCF8`, blue `#2346D8`, ink `#1C2C59`, mist `#DDE9F5` | Blue is familiar; mark and typography must carry the distinction. |
| Current control | Existing Bindrune and navy/brass | Production uses Syne, Epilogue and IBM Plex Mono. This local reconstruction uses Arial/Consolas fallbacks. | Navy `#0C1420`, panel `#131D2C`, brass `#C9A86A`, text `#E8ECF2` | A comparison control, not a live-app screenshot or a new identity direction. |

The UI fonts are local study choices, not final font procurement decisions. No font binaries are bundled or fetched. Generated letterforms are concept studies, not a license to a named commercial font. Refine the chosen mark into an original vector master after selection and check trademark availability before release. No trademark clearance is claimed here.

Selection required before production work:

1. Choose the identity direction, or request a specific revision using this package.
2. Review the proposed page hierarchy separately from the visual direction. Top navigation versus sidebar is a proposal, not a locked architectural requirement.
3. After selection, refine mark geometry, mono/reversed/16px variants, final type, contrast, accessibility and product tokens. Then apply the approved migration incrementally.

Functional repairs and current-flow usability improvements are independent and should not wait for a brand decision.

## What's included

| Artifact | Location | Count |
| --- | --- | --- |
| Original raster identity boards | `art/edition-board.png`, `art/vector-board.png`, `art/horizon-board.png` | 3 at 1536 × 1024 |
| Candidate desktop screens | `screens/{edition,vector,horizon}-{brief,opportunities,career,review}-desktop.jpg` | 12 |
| Candidate mobile screens | Same convention with `-mobile.jpg` | 12 |
| Current-style control | `screens/current-{brief,opportunities,career,review}-{desktop,mobile}.jpg` | 8 |
| Live-text mockup source | `mockup.html`, `mockup.js`, `mockup.css` | 16 theme/screen combinations |
| Review gallery | `index.html`, `gallery.css` | 1 |
| Prompt provenance | [prompts.md](prompts.md) | 3 concepts plus Vector correction |
| Verification | [qa.md](qa.md), `browser-checks.json`, `manifest.json`, `validate_package.py` | Local evidence |
| Navigation and migration | [identity-storyboard.md](../../docs/continuation/identity-storyboard.md) | All 40 current page routes |

Desktop images are 1440px wide, mostly 1280px high. The current Opportunities control is 1320px high to include the full footer. Mobile images are 375px wide and are scroll studies, not claims that an entire page fits in a physical phone viewport. They were also checked at a 375 × 900 viewport. Full single-frame captures avoid a browser full-page stitching artifact found during preparation. Image dimensions and SHA-256 hashes are in the manifest.

The existing `apps/web/public/brand/kall-mark.svg` is copied unchanged to `assets/current-bindrune.svg` solely for the control. Production assets remain untouched. The three new logo concepts appear in the raster boards; the live-text wordmarks in the mockups are readable stand-ins, not final vector reconstructions.

## Sample story and product boundaries

All directions share one source, `mockup.js`, for their content. Alex Morgan, Example Company, Northstar Labs, Signal Works and Fieldnote are fictional. No private resume, contact details or real job feed is used.

- Brief: three new matches, one application awaiting review, and a synthetic monitoring check at 09:10.
- Opportunities: Director, Quality Engineering at Northstar Labs, remote in the United States, $170k–$205k base, illustrative 92% fit. Signal Works and Fieldnote are the other two jobs. Mobile shows the selected role and its detail in sequence.
- Career: Quality Engineering leadership, functional areas Quality Engineering and Engineering Leadership, remote USA, $175,000 target, preserved exclusions for commission-only work and unpaid internships.
- Application review: the same role and Alex's fictional 12-person team experience. Approval is disabled because sensitive fields remain unconfirmed. Submission is separate.

The 92% fit is illustrative, not a measured model result or offer probability. The functional-area explanation shows one capped 10-point bonus. The monitoring example is a concept state, not evidence of a deployed worker or verified email sender. It creates no alerts, sends no email, and changes no preferences.

Incidental generated board copy is exploratory. Edition's “Meaningful connections” line does not commit Kall to a networking feature. The detailed screen text is the authoritative content comparison. “One good conversation” is general career encouragement, not a messaging feature.

Job Intelligence remains posting-fit evidence. Growth remains career development. Immediate search and profile-first entry remain available in the proposed navigation. Application approval, sensitive-field confirmation, ownership and submission behavior are not changed by the exploration.

## Integration

This lane adds only `design/identity-exploration/` and `docs/continuation/identity-storyboard.md`. It has no runtime dependency, migration, secret, environment configuration, outbound integration or production build change. Cherry-pick the lane commit onto the coordinator's integration branch; no shared production-file conflict is expected. Keep images with the gallery because it uses relative paths.

GitHub required CI remains an external coordination concern. This design package does not bypass it and does not claim backend or browser production-suite coverage. See the QA log for exactly what was inspected.

Screen captures retain the browser tool's original JPEG bytes, with matching `.jpg` extensions. Concept boards retain the image tool's original PNG bytes. No conversion or image editing was applied to the browser captures.
