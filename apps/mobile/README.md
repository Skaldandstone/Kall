# Kall Mobile

A native iOS/Android app (Expo + React Native) for Kall's daily career workflow. It carries the web app's core capabilities into focused mobile screens instead of copying desktop layouts. It calls
the same FastAPI backend directly (no server-side proxy, unlike the web
app's `/api/kall/[...path]` route - see `docs/AWS_DEPLOYMENT.md`'s "Public
API path" section for how the API was made reachable for this).

## Screens

- **Login / Register** - `src/screens/LoginScreen.tsx`, `RegisterScreen.tsx`. Identity is Clerk (`@clerk/expo` v4, the signals API - methods resolve to `{ error }` rather than throwing). Unlike the web app, mobile calls the backend directly rather than through a proxy, so it holds a session token; that token is cached via `expo-secure-store` (Keychain/Keystore), not `AsyncStorage`.
- **Applications** - `src/screens/ApplicationsScreen.tsx`. Lists every application from `GET /me/applications`, the same pipeline endpoint the web app's applications page reads.
- **Application detail / review** - `src/screens/ApplicationDetailScreen.tsx`. The core loop: shows readiness issues, confirms review items, approves the application - the same three endpoints (`POST/GET/PUT /applications/{id}/review`, `POST /applications/{id}/review/approve`) the web app's `apps/web/app/applications/[id]/page.tsx` calls.
- **Morning Brief** - `src/screens/MorningBriefScreen.tsx`. Read-only, `GET /me/morning-brief`.
- **Jobs** - search configured sources, review match evidence, save or dismiss a role, and prepare an application with a selected resume.
- **Profile workspace** - edit personal details and career profiles, upload and manage resumes, and change email notification preferences.

## Not yet built (explicit follow-up, not silently dropped)

- **Push notifications.** Needs Firebase Cloud Messaging (Android) and APNs (iOS) credentials/developer-account setup that don't exist yet - this is infrastructure outside this repo, not a code gap.
- **Desktop-heavy editors.** Paragraph-level resume tailoring, the public career-page layout editor, privacy field rules, search-source administration, and account deletion remain web-only. Mobile links its daily workflow together and includes a store-compliant plan screen; it falls back to web billing until native products are activated.

Native Apple and Google billing setup and release gates are documented in
[`docs/NATIVE_BILLING.md`](../../docs/NATIVE_BILLING.md).

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

| What                  | Where                                                             | Override                                    |
| --------------------- | ----------------------------------------------------------------- | ------------------------------------------- |
| API base URL          | `app.json` → `expo.extra.apiBaseUrl` (Android emulator localhost) | `API_BASE_URL` env var                      |
| Clerk publishable key | `app.json` → `expo.extra.clerkPublishableKey`                     | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` env var |
| Sentry client DSN     | Disabled locally unless configured                               | `EXPO_PUBLIC_SENTRY_DSN` env var             |

The defaults support local Android-emulator development and the development
Clerk instance. A review or production build must set `KALL_MOBILE_RELEASE=1`,
`API_BASE_URL` to the selected HTTPS runtime ending in `/api`, and
`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, and `EXPO_PUBLIC_SENTRY_DSN`. `app.config.js` fails the build when any
release value is missing, so an APK cannot silently ship with a localhost or
expired CloudFront URL or without crash reporting. Store `SENTRY_AUTH_TOKEN` as
a sensitive EAS production environment variable so release source maps upload
to the `skald-and-stone/kall-mobile-sp` Sentry project. The token is build-only and
must never be added to `app.json`, committed, or exposed through `extra`.

Build the signed internal APK from PowerShell after the alpha URL is known:

```powershell
Set-Location -LiteralPath 'C:\Users\James\Documents\GitHub\Kall\apps\mobile'
.\scripts\build-alpha-apk.ps1 -ApiBaseUrl 'https://kall.skaldandstone.com/api' -ClerkPublishableKey 'pk_live_...' -SentryDsn 'https://public-key@o0.ingest.sentry.io/0'
```

The first run creates a dedicated alpha signing key under
`$env:USERPROFILE\.kall\android`, locks the directory to the current Windows
user, and protects the password with Windows DPAPI. Private signing material is
never written into this repository. Keep that local directory backed up: later
alpha APKs must use the same key to upgrade an existing installation.

### Building the iOS alpha from Windows

EAS Build can compile the iOS project in Expo's macOS build environment, so a
local Mac is not required. Both iOS profiles use the same release safeguards as
the Android alpha: the vanity API base, the alpha Clerk publishable key, and
self-service registration disabled.

Validate the bundle identifier, build number, icon, release profiles, and
retired-host exclusion locally:

```powershell
Set-Location -LiteralPath 'C:\Users\James\Documents\GitHub\Kall\apps\mobile'
npm run validate:ios-alpha
```

After signing in to Expo, queue a release-mode iOS Simulator build. This build
does not require Apple Developer membership, but its `.app` artifact runs only
in an iOS Simulator on a Mac:

```powershell
npx eas-cli@23.2.0 login
.\scripts\build-alpha-ios.ps1 -Target Simulator -Wait
```

An installable invite-only iPhone build uses the `ios-device-alpha` internal
distribution profile. Apple Developer membership, an Apple signing team, and
the test device UDID are required before EAS can create its ad hoc provisioning
profile:

```powershell
.\scripts\build-alpha-ios.ps1 -Target Device -Wait
```

These profiles do not submit anything to TestFlight or the App Store. Store
submission remains a separate provider action after device testing and review.

### Building for Google Play

The `android-production` EAS profile is a separate path from the local
sideloaded alpha APK above: it produces an `.aab` (Android App Bundle, what
Play requires for new app submissions) and lets EAS manage its own Android
upload keystore rather than reusing the local one under
`$env:USERPROFILE\.kall\android`. It deliberately does **not** set
`KALL_MOBILE_LOCAL_ANDROID_SIGNING` -- see `app.config.js` -- so the
`with-release-signing` config plugin (which expects Gradle properties only
`build-alpha-apk.ps1` sets) never applies to this build.

```powershell
Set-Location -LiteralPath 'C:\Users\James\Documents\GitHub\Kall\apps\mobile'
npx eas-cli@23.2.0 login
npx eas-cli@23.2.0 build --platform android --profile android-production
```

If no Android credentials exist yet for this project, EAS prompts to generate
a new upload keystore (or lets you supply your own) on first run -- accept the
generated one unless there's a specific reason to bring an existing key. That
upload key is what gets enrolled in Google Play App Signing the first time the
resulting `.aab` is uploaded to Play Console; Google then holds the actual
app-signing key and re-signs what it distributes, per the Play App Signing
Terms of Service accepted when the app was created in Play Console.

The build-only command above remains available for the first manual upload.
Google requires one manual upload before API submissions can work.

### Automatic store submission

Run these commands in PowerShell from this mobile directory:

```powershell
npm run release:android
npm run release:ios
# Once both stores have credentials:
npm run release:all
```

Each command builds the `production` profile and automatically submits that
exact build with the matching submission profile. Android targets the selected
Google Play closed Alpha track; iOS targets TestFlight. Public release remains
a separate store action. EAS maintains remote build numbers and increments each
store build so repeated CI runs do not reuse numbers from an unchanged checkout.

For an explicit internal-only QA submission, submit the build with the
`internal-qa` profile:

```powershell
npx eas-cli@23.2.0 submit --platform android --id <EAS_BUILD_ID> --profile internal-qa --wait --non-interactive
```

Google Play does not accept a second upload of the same version code to another
track. If internal QA is used first, promote that release to Closed testing in
Play Console. The default automated workflow avoids this step by submitting a
new version directly to Closed testing Alpha.

Android needs its Google Play service account key configured through
`npx eas-cli@23.2.0 credentials --platform android`, plus access to Kall in
Play Console. Store the key in EAS credentials, never in this repository.
The existing Android push/manual workflow now includes auto-submit.

iOS cloud builds and submission work from Windows without local Xcode.
First enroll in Apple Developer, create Kall in App Store Connect using
`com.skaldandstone.kall`, and put its numeric Apple ID in
`submit.production.ios.ascAppId` in `eas.json`. Configure signing and an
App Store Connect API key using `npx eas-cli@23.2.0 credentials --platform ios`.
The release script blocks iOS/all before queuing any build until the app ID is
present. `-- --check` checks local prerequisites only, not remote credentials.
The iOS GitHub workflow is manually triggered after setup, using the repository
`EXPO_TOKEN` secret. Workflow changes take effect after they reach GitHub.

References: [automatic submission](https://docs.expo.dev/build/automate-submissions/),
[Android setup](https://docs.expo.dev/submit/android/),
[iOS setup](https://docs.expo.dev/submit/ios/).

### OTA updates (EAS Update)

A JS/asset-only change (a screen, an API call, styling -- everything in this
session's applications feed work, for instance) does not need a new store
submission. `expo-updates` is configured with `runtimeVersion.policy:
"fingerprint"` (`app.json`), so a build's compatibility with an update is
computed from what's actually native about it rather than a hand-maintained
version number.

Two channels, matching the two places builds already go:

| Channel      | Build profiles                               | Reaches                              |
| ------------ | --------------------------------------------- | ------------------------------------- |
| `preview`    | `ios-simulator-alpha`, `ios-device-alpha`     | Alpha testers, before it's trusted    |
| `production` | `android-production`, `production`            | Everyone on the current store release |

Publish with:

```bash
npm run update:preview      # or: npm run update:production
```

This ships to everyone on that channel's installed build within the app's
next foreground check -- no store review, typically live in minutes.

**What this does NOT cover.** Anything that changes the native fingerprint --
a new native module, a changed permission, an `app.json`/`expo-build-properties`
change, a bumped native dependency -- changes `runtimeVersion` under the
fingerprint policy, so a build on the old fingerprint will not even offer
that update to itself; a new build (and, for a permission or capability
change, a new store submission) is required regardless. Apple's and Google's
rules also prohibit using an OTA update to change what the app fundamentally
does -- this is for fixes and JS-level features, not a way around review for
anything that would otherwise need one.

`android-e2e` and `ios-e2e` deliberately have **no** channel: `expo-updates`
only checks for an update when a channel is configured, and these builds
pin an exact `KALL_MOBILE_E2E_VERSION` against a known backend specifically
so a run is reproducible. Wiring a channel in would let a mid-run OTA fetch
silently swap the JS bundle a test is exercising.

## Structure

```
src/
  api/            Typed fetch wrappers -- one file per backend area (auth, applications, brief)
  auth/           AuthContext: session state, backed by expo-secure-store
  navigation/     Auth-gated stack navigators (React Navigation)
  screens/        One file per screen
  theme.ts        Colors matching the web app's dark theme
```
