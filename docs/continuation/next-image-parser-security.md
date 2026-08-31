# Next image parser exposure review

2026-08-31, integration owner `01a0546e-37c4-78a3-8731-d26b2350af10`.
Local follow-up to `4c429877983ddba6345d8a1dc4842f3f7f4594ec` on
`codex/kall-billing-isolation`. PR #171 remains at that published checkpoint;
this follow-up was not pushed, dispatched, merged or deployed.

## Finding and reachability

Installed Next is **15.5.23**. Its vendored
`next/dist/compiled/image-size/index.js` has SHA-256
`f824c02fbd558131c8d433c04c245fa3a50f6120024d78485c9b69005e2e654e`.
It is byte-identical to the copy reported by the cross-product security review.
This is a reproduced parser defect, not a claim about a particular advisory ID.

Sequential synthetic worker probes reproduced `ERR_WORKER_OUT_OF_MEMORY` for
a 16-byte ICNS with a zero-length entry and a 32-byte JXL with a zero-length
partial codestream box. Both the direct parser and Next's `getImageSize` helper
failed **after successfully loading**. A real, trusted 192px Kall PNG returned
the correct dimensions through both interfaces. Each worker had a 32 MB V8 old
generation limit, 4 MB young generation limit and a ten-second termination
watchdog. These are V8 limits, not a 32 MB total-process/RSS claim. Probes were
sequential, made no network requests, and never parsed hostile bytes on the
parent/server event loop. See [recorded results](next-image-parser-probe.json).

| Surface at the published checkpoint | Kall-specific finding |
| --- | --- |
| `/_next/image` | Enabled by default despite no `next/image` consumers. Middleware deliberately excludes Next internals. A signed-out loopback request optimized `/icon-192.png` with HTTP 200. |
| ICNS/JXL through the optimizer | **Not the reproduced dimension-parser path.** Next's `BYPASS_TYPES` includes both types. Calling the actual optimizer with both malformed buffers returned the original bytes without dimension parsing. A remote parser exploit in current Kall was not established. |
| Remote image URLs | No configured domains or remote patterns. A loopback external-source URL returned 400 before the change, with zero requests to the synthetic source server. No external image was fetched. |
| Static image imports | Next's default webpack image loader calls `getImageSize`. No such imports exist in Kall's production sources. This build-time path would require introducing source assets/imports, not merely a public URL. |
| File-based metadata images | Separate metadata loader also calls `getImageSize`. Kall currently has no `app/icon.*`, `favicon.*`, `opengraph-image.*` or `twitter-image.*` files. `layout.tsx` references trusted public icon URLs with explicit sizes. This loader is **not disabled** by `disableStaticImages`. |
| Public assets | Five tracked PNG icons, five authored SVG brand assets and the manifest are served directly. KallMark is inline SVG. No user upload writes to this source/public tree. |
| Uploads/proxy/embeds | Resume uploads require backend authentication, allow PDF/DOCX/TXT extensions, and use Python text extraction/storage. They do not call this Next parser. The Next API proxy targets the configured backend and derives the token from Clerk; it is not an arbitrary image URL fetcher. Public career embeds use curated iframe URLs/links, not `next/image`. |

Reviewed installed source: `dist/server/next-server.js` image request handler;
`dist/server/image-optimizer.js` format detection, bypass list and `getImageSize`;
`dist/build/webpack-config.js` image rule; `next-image-loader` and
`next-metadata-image-loader`. Also reviewed Kall middleware, API proxy, resume
upload handler, public career page, root metadata and container build/start path.
The container runs `next build` followed by `next start`; the local HTTP check
uses that same production start command, not the isolated UI fixture.

## Local mitigation

`apps/web/next.config.mjs` now sets:

```js
images: {
  unoptimized: true,
  disableStaticImages: true,
},
```

These are supported Next options documented in the
[versioned upstream Image documentation](https://github.com/vercel/next.js/blob/v15.5.23/docs/01-app/03-api-reference/02-components/image.mdx#unoptimized)
and its [static import section](https://github.com/vercel/next.js/blob/v15.5.23/docs/01-app/03-api-reference/02-components/image.mdx#disablestaticimages).
The installed request handler checks `unoptimized` before validating/fetching
an image and renders 404. The webpack image-import rule is conditional on
`disableStaticImages`. Next regenerated `next-env.d.ts` without its image-import
type reference during the successful build; that generated adjustment is included.

This removes unused server/build exposure without changing CSP, auth, embeds,
public icons, billing, notices, Inscription selection or application safeguards.
No dependencies or lockfiles changed. The vulnerable vendor bytes are unchanged.

## Checks actually run

From `apps/web` in the continuation integration worktree:

- `node security/image-parser-probe.cjs`: eight bounded observations described
  above, including four intentional parser/worker failures. This diagnostic's
  successful completion is **not** a passing parser-security result.
- `node security/image-exposure.cjs baseline` before the config edit: 14 HTTP
  assertions passed, including optimizer 200, rejected external-source 400,
  missing-parameter 400 and eleven original static assets. A second attempt to
  record baseline output after changing the source config correctly observed
  404 instead of 200 and failed. Next start reads the source config too; the
  harness now explicitly checks both source and built config before running.
  The first baseline result is historical; no baseline JSON is claimed.
- Production build using installed `node node_modules/next/dist/bin/next build`:
  passed, all 43 static pages generated. Child environment contained only OS
  essentials, telemetry-off flags, billing-off and a synthetic Clerk public key.
  Existing CSS/autoprefixer/cache warnings remain. No real provider keys used.
- `node security/image-exposure.cjs` after rebuilding: **17 HTTP assertions
  passed**. Six optimizer requests returned 404, including local icon, loopback
  external source, missing query, API path, ICNS path and JXL path. All eleven
  public files returned 200 with exact original bytes and nosniff. Synthetic
  backend/source received zero requests. See [HTTP evidence](next-image-http-mitigated.json).
- Installed TypeScript `tsc --project apps/web/tsconfig.json --noEmit --incremental false`:
  passed. Both security scripts passed `node --check`.
- `.venv/Scripts/python.exe -m pytest tests/test_embeds.py tests/test_resume_upload.py -q`:
  **27 passed**; existing deprecation warnings only. These cover existing embed
  and upload behavior; no backend code changed.
- `git diff --check`: passed. Full backend/Clerk/browser/device suites were not
  repeated for this configuration-only production change. Prior 587 backend,
  42 safe browser and 90 PostgreSQL results remain dated checkpoint evidence.

The HTTP harness binds its own child and synthetic backend to loopback, refuses
local production `.env` files, supplies no secret keys and stops its own child
afterward. It never runs Playwright's real Clerk setup. The malformed buffers
exist only inside the diagnostic workers, never in public assets or an HTTP
upload. Builds/byte comparisons do not establish new visual/device acceptance.

## Remaining risks and release holds

- **The parser is still vulnerable.** Disabling routes/loaders is exposure
  reduction, not a parser repair or advisory suppression. Direct imports,
  file-based metadata images and future dependencies could still call it.
- Keep file-based metadata images and new image-processing paths behind review.
  Do not ingest user assets into source builds or reopen optimization without
  explicit input-boundary review and a verified upstream parser fix. A future
  supported dependency update must verify the actual vendored copy and rerun
  bounded rejection/control probes, production build and HTTP tests.
- The diagnostic covers these two malformed samples, not all image formats or
  native decoder vulnerabilities. The local UI fixture has its own config and
  remains a loopback-only synthetic QA app, not the production image policy.
- This change is **local only**. Published PR #171 and any deployed server still
  have their prior configuration until separately authorized review/release.
  No cloud/provider mutation, install, paid job, workflow dispatch, PR update,
  push, merge or deployment occurred. Existing live billing/email/monitoring,
  detailed identity/navigation and device acceptance holds remain in force.

Next owner action: review this local mitigation with the existing PR #171 stack
and authorize its publication/release when appropriate. No credentials or
business decision are needed to keep the local safeguard. Upstream replacement
and deployment acceptance remain separate follow-up gates.
