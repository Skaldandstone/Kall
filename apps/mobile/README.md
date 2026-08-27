# Kall Mobile

A native iOS/Android app (Expo + React Native) for the core "review and act
on a prepared application" loop - not a full mirror of the web app. It calls
the same FastAPI backend directly (no server-side proxy, unlike the web
app's `/api/kall/[...path]` route - see `docs/AWS_DEPLOYMENT.md`'s "Public
API path" section for how the API was made reachable for this).

## Screens

- **Login / Register** - `src/screens/LoginScreen.tsx`, `RegisterScreen.tsx`. Same `/auth/login` and `/auth/register` endpoints the web app uses; the token is stored via `expo-secure-store` (Keychain/Keystore), not `AsyncStorage`.
- **Applications** - `src/screens/ApplicationsScreen.tsx`. Lists every application from `GET /me/applications`, the same pipeline endpoint the web app's applications page reads.
- **Application detail / review** - `src/screens/ApplicationDetailScreen.tsx`. The core loop: shows readiness issues, confirms review items, approves the application - the same three endpoints (`POST/GET/PUT /applications/{id}/review`, `POST /applications/{id}/review/approve`) the web app's `apps/web/app/applications/[id]/page.tsx` calls.
- **Morning Brief** - `src/screens/MorningBriefScreen.tsx`. Read-only, `GET /me/morning-brief`.

## Not yet built (explicit follow-up, not silently dropped)

- **Push notifications.** Needs Firebase Cloud Messaging (Android) and APNs (iOS) credentials/developer-account setup that don't exist yet - this is infrastructure outside this repo, not a code gap.
- **Documents, Opportunities, Career sections.** The mobile app is scoped to the assisted-application review loop, matching what this README originally called out as the priority mobile flows. Expanding to full parity with the web app is a separate, larger effort.

## Development

```bash
cd apps/mobile
npm install
npx expo start
```

Scan the QR code with Expo Go (iOS/Android) for the fastest loop, or press `a`/`i` to open an emulator/simulator if you have Android Studio/Xcode installed.

The API base URL is set in `app.json` under `expo.extra.apiBaseUrl` (defaults to the production CloudFront URL, `https://d7wb2yokfqcku.cloudfront.net/api`). Override it for local backend development by editing that value or exporting `EXPO_PUBLIC_API_BASE_URL` and reading it in `src/api/client.ts` if you need per-environment builds later.

## Structure

```
src/
  api/            Typed fetch wrappers -- one file per backend area (auth, applications, brief)
  auth/           AuthContext: session state, backed by expo-secure-store
  navigation/     Auth-gated stack navigators (React Navigation)
  screens/        One file per screen
  theme.ts        Colors matching the web app's dark theme
```
