# Letting the extension see who is signed in

Kall's Chrome extension used to ride the browser's own Clerk session cookie
(`fetch(credentials: 'include')` against the web app's proxy). That looked
right until anyone actually tried it: the cookie is `SameSite=Lax`, and a
fetch from the extension's own `chrome-extension://` origin is a cross-site
request by definition, so the browser never attached it. Someone fully signed
in on the web app would still see "sign in to Kall" from the popup, always,
because the popup had no way to prove they were.

The fix is [`@clerk/chrome-extension`](https://clerk.com/docs/guides/sessions/sync-host)'s
**Sync Host** feature — the extension gets its own session, kept in step with
the web app's, and calls the backend directly with a bearer token instead of
depending on any cookie policy at all. That part is built and tested. One
step only Clerk's dashboard can do is not:

## Register the extension's origin

Clerk will not sync a session to an origin it does not know about. The
extension's id is fixed — its manifest pins a `"key"`, so it is
`lgbplmcainecdbbkameldmpafdcnpaid` on every machine that loads it unpacked,
not something that varies per install.

```bash
curl -X PATCH https://api.clerk.com/v1/instance \
  -H "Authorization: Bearer <CLERK_SECRET_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"allowed_origins": ["chrome-extension://lgbplmcainecdbbkameldmpafdcnpaid"]}'
```

Use the secret key for whichever Clerk instance the extension should sync
with — the development instance for local testing, the production one once
that exists (see `docs/NEEDS_DECISION.md`). Do this once per instance; it is
not something the extension or the web app can set on their own.

If this step is skipped, the symptom is exactly the one this whole change
exists to fix: the popup still says "sign in required" no matter how
thoroughly someone is signed in on the web app, and nothing in the extension
can tell you why, because Clerk's own sync silently declines to sync rather
than erroring.

## Building the extension

`popup.js` now imports a real npm package, which a browser cannot load from
a bare specifier — it has to be bundled first:

```bash
cd apps/extension
npm install
npm run build        # produces src/popup.bundle.js, gitignored
```

Then load unpacked as before (`chrome://extensions` → Developer mode → Load
unpacked → `apps/extension`). Re-run `npm run build` after editing
`popup.js`, `auth.js`, `api.js`, or `config.js` — `content.js` and
`matcher.js` are unbundled and untouched by any of this; edits there take
effect on the next reload with no build step.

## What was not changed

- `content.js` still holds no credential and never talks to Kall's origin at
  all — it only reads and writes form fields on the employer's page, exactly
  as before.
- The account still has one identity, Clerk's. Nothing here creates a second
  login or a separate password; syncing a session is not the same thing as
  having one.
