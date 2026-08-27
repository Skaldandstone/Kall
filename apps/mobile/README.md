# Kall Mobile

A native iOS/Android app (Expo + React Native) for the core "review and act
on a prepared application" loop - not a full mirror of the web app. It calls
the same FastAPI backend directly (no server-side proxy, unlike the web
app's `/api/kall/[...path]` route - see `docs/AWS_DEPLOYMENT.md`'s "Public
API path" section for how the API was made reachable for this).

## Screens

- **Login / Register** - `src/screens/LoginScreen.tsx`, `RegisterScreen.tsx`. Identity is Clerk (`@clerk/expo` v4, the signals API - methods resolve to `{ error }` rather than throwing). Unlike the web app, mobile calls the backend directly rather than through a proxy, so it holds a session token; that token is cached via `expo-secure-store` (Keychain/Keystore), not `AsyncStorage`.
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

Scan the QR code with Expo Go for the fastest loop, or press `a`/`i` for an
emulator once Android Studio/Xcode is installed.

### Running on Android

Expo Go covers most work. A **native** build is needed only once something
Expo Go cannot load is added - a config plugin with native code, a custom
native module, or push notifications.

```bash
npx expo run:android        # builds and installs a debug build on the emulator
```

That generates an `android/` directory the first time. It is derived output:
regenerate it with `npx expo prebuild --clean` rather than hand-editing it,
because anything edited there is lost on the next prebuild.

The app id is `com.skaldandstone.kall`, set as `android.package` in
`app.json`. **It is permanent once the app is published to Google Play** - a
package name cannot be changed afterwards without shipping a new listing - so
change it now if it should be anything else. `ios.bundleIdentifier` matches.

### Configuration

| What | Where | Override |
| --- | --- | --- |
| API base URL | `app.json` → `expo.extra.apiBaseUrl` | `API_BASE_URL` env var |
| Clerk publishable key | `app.json` → `expo.extra.clerkPublishableKey` | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` env var |

Both defaults point at the development Clerk instance and the production
CloudFront API. `app.config.js` reads the env vars, so a production build
**must** set `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` or it ships pointing at the
dev Clerk instance - which fails quietly rather than loudly.

## Structure

```
src/
  api/            Typed fetch wrappers -- one file per backend area (auth, applications, brief)
  auth/           AuthContext: session state, backed by expo-secure-store
  navigation/     Auth-gated stack navigators (React Navigation)
  screens/        One file per screen
  theme.ts        Colors matching the web app's dark theme
```
