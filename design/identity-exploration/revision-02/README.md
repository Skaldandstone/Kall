# Kall identity correction, round 02

Status: **candidate_not_approved**. Prepared 30 August 2026. [Open the gallery](index.html), [visual QA](qa.md), [asset manifest](manifest.json), or [navigation and route proposal](../../../docs/continuation/identity-storyboard.md).

This round responds to James's feedback that the first studies did not read like Kall's Runestone. Edition's recommendation is withdrawn. The original images remain in [historical round 01](../round-01.html), unchanged and unapproved. This correction does not replace production assets or authorize a navigation migration.

## Foundation and correction

The authority is the repository [Kall Human Interface Guidelines](../../../docs/khig/human-interface-guidelines.md), [product vision](../../../docs/prd/00-product-vision.md), [brand brief](../../../docs/BRAND.md), and [existing KallMark](../../../apps/web/app/components/KallMark.tsx). The Notion [Design System, Volume IV](https://app.notion.com/p/3b0519434a4281b5b551ffabb736f8a9) and [Vision and Strategy, Volume I](https://app.notion.com/p/3b0519434a428151886ffdb504acdc99) support the same foundation. These sources were read during the correction. No separate document literally titled Runestone was found; these sources and James's feedback guide this package.

Kall is a private Career Operating System for a working life, not only a search for the next job. The common visual foundation is dark graphite and layered charcoal, warm text, restrained fjord blue, thin borders, low elevation and deliberate hierarchy. The crossing-stave rune is invariant: a vertical stave with a left-pointing chevron crossing it, sharp joins and flat caps. It is not an ordinary letter K. Every authored screen uses the existing geometry exactly; no production mark file changed.

Brief now leads with saved strategy and the professional record. Opportunities sit within that context. Job Intelligence explains posting fit, including a single capped functional-area bonus and no penalty for missing evidence. Growth remains career development. Application review retains the outstanding sensitive-field confirmation, disabled approval and separate submission action.

## Three expressions of the same identity

| Direction | Expression | Local study type | Main UI colors | Review consideration |
| --- | --- | --- | --- | --- |
| Stave | Precise carved geometry, modern grotesk, structured sidebar | Bahnschrift / Arial, Consolas | Graphite `#151A1D`, panel `#20282D`, warm text `#E8E6DF`, accent `#9BBAC8` | Closest to the written foundation. Keep its precision calm rather than mechanical. |
| Inscription | Cut serif lettering, lasting career record, top navigation | Georgia display, Arial controls, Consolas | Charcoal `#1B1C1D`, panel `#232526`, text `#E8E6DF`, accent `#A2BBC6` | Broadest type exploration. Avoid turning the product into an editorial or luxury brand. |
| Fjord | Open humanist type, more breathing room, softened containers | Segoe UI / Arial, Consolas | Blue graphite `#172126`, panel `#23323A`, text `#E9E7DF`, accent `#A1C2CF` | More approachable spacing, while keeping the carved mark and dark foundation. |
| Current-style control | Existing navy/brass with the same revised content | Arial / Consolas local substitutes | Navy `#0C1420`, panel `#131D2C`, brass `#C9A86A`, text `#E8ECF2` | Reconstruction for comparison, not a production screenshot. |

The raster boards use darker material accents; live-text UI accents are lightened for legibility. Generated letterforms and material photography are exploratory. Fonts are local substitutes, no font binaries or third-party network assets are included. Final type selection and licensing, size variants, accessibility and production tokens still require review.

**Review recommendation:** use Stave as the reference for the next charter-alignment discussion. It keeps the rune, material and interface closest to the written foundation. This is a design judgment, not user research or approval. James must confirm that the corrected character reads as Kall, then select a direction or request revisions. No direction is selected. The broader hierarchy requires a separate decision before implementation.

## Inventory and use

- Three 1536 x 1024 raster identity boards with mark studies, type, palette and product context.
- Twelve desktop and twelve mobile candidate screen JPEGs: Brief, Opportunities, Career and application review in each direction.
- Eight current-style control JPEGs using the same revised content.
- Desktop captures are 1440 x 1400. Mobile captures are 375 x 1805 scroll studies, not literal device frames. Mobile layout checks also ran at 375 x 900.
- A full-resolution file selector, live-text previews, exact rune reference, generation notes, machine-readable QA records and SHA-256 manifest.

Alex Morgan, Example Company, Northstar Labs and Signal Works are fictional examples. All sample data is synthetic, with no private resume or contact details. The main copy is identical across themes. Visible fit scores, dates and check status are examples, not live service output. The sample views do not promise new networking, career analytics or automatic submission features.

Serve the parent directory from the repository root:

```powershell
python -m http.server 4319 --bind 127.0.0.1 --directory design/identity-exploration
```

Open <http://127.0.0.1:4319/revision-02/>. The gallery also opens as a file. Screen navigation is a local preview; save, pause, preparation and other mutations show a preview notice. No data is sent or persisted. Rebuild authored study sources with `python design/identity-exploration/revision-02/build_studies.py`; image capture is a separate browser review step. Validate the finished inventory with `python design/identity-exploration/revision-02/validate_package.py`.

## Integration boundary

This round is separate from withdrawal commit `5e647001cc9aeaebbd97e8801b7a5ef7aea2e6b2` and historical package `edfecf342ba0eceb0b374d9894f681f5eb242dcb`. Only this artifact directory, the parent gallery entry/notes and the identity storyboard are owned by this lane. The parent historical source files remain available because the round-two builder reads them. No new runtime dependency, cloud resource or paid service is introduced. Production brand selection is not required to release independent functional repairs.

The coordinator reported PR #169 run `33339187268` passed all five required jobs. The earlier runner-start payment/spending restriction did not recur. Draft PR #170 has its own CI; its status must be checked on that PR. This lane changed no billing settings and bypassed no checks.
