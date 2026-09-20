# Kall Apply (Chrome extension)

Pre-fills employer application forms from a Kall profile and saves any job
posting you are browsing to your Kall opportunity inbox. The person applying
always reviews and submits the form themselves; there is no code path here
that submits anything.

## Build and load

```bash
npm ci
npm run build          # writes src/popup.bundle.js (gitignored)
```

Then load `apps/extension` unpacked at `chrome://extensions`. The popup's
`popup.html` loads `popup.bundle.js`, not `popup.js`, so the build must run
before the extension is loaded; rebuild after changing anything `popup.js`
imports. `content.js` and `matcher.js` ship unbundled (see
`esbuild.config.mjs` for why).

The web app's Clerk instance must know the extension's origin before sign-in
sync works: see `docs/EXTENSION_CLERK_SETUP.md`.

## Tests

```bash
npm run test:unit      # node --test: matcher, api, sentry
npm run test:dom       # Playwright: the real content script against fixture pages
npm test               # both
```

The DOM suite needs a Chromium from `npx playwright install chromium` once.

## Error tracking (Sentry)

Unhandled and handled errors in the popup report to the `kall-extension`
project in the `skald-and-stone` Sentry org, with the same privacy stance as
the web app (`apps/web/lib/sentry-shared.ts`): no user identity, no
breadcrumbs, no request URLs, no session replay, no tracing. `src/sentry.js`
holds the configuration; `content.js` is deliberately not instrumented
because it runs inside the employer's page.

The DSN is compiled into the bundle at build time and the SDK is inert
without one -- the code is still in `popup.bundle.js` (esbuild inlines the
dynamic import), but it is never initialized and nothing is sent:

```bash
SENTRY_DSN=https://...@o....ingest.us.sentry.io/... npm run build
```

`SENTRY_ENVIRONMENT` (default `production`) tags the events; the manifest
version becomes the release (`kall-extension@<version>`). See `.env.example`
and `docs/PRODUCTION_DEPLOYMENT.md` section 3a. A DSN is public by design (it
can only send events to one project), which is why it can live in a build
step rather than a secret store. CI builds without one and sends nothing.

Outgoing events are scrubbed in `scrubEvent`: user, breadcrumbs and request
data are dropped, and any URL inside an error message (Chrome writes the
active tab's URL into its own `Cannot access contents of url "..."` error)
is replaced with `<url>` before it leaves the extension.
