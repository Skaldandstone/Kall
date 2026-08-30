# Local UI fixture

This is a separate Next.js app importing Kall's production UI components. It has no Clerk provider, production middleware, backend proxy, credentials, or external sender. Its API route returns synthetic examples and refuses unknown mutations. It is never part of the production app router.

From `apps/web`, run `npm ci`, then:

```powershell
$env:KALL_UI_PORT = '3310'
npx playwright test --config playwright.usability.config.ts
```

For interactive screenshots:

```powershell
node node_modules/next/dist/bin/next dev usability-fixture --hostname 127.0.0.1 --port 3310
```

The fixture routes mirror `/dashboard`, `/morning-brief`, `/search`, `/applications/new`, `/applications/41`, `/profiles`, `/onboarding`, and `/settings/notifications`. Re-export another real page to add coverage. Override `/api/kall/**` with Playwright `page.route` for lane-specific fixtures, delays and failures. Requests never forward to Kall's backend. Each lane must use its assigned port and synthetic data. Existing real-auth specs remain separate and must not use this fixture as proof of Clerk or backend integration.

No API port is needed. The reserved API port 8310 is unused.
