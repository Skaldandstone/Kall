# Kall App Store screenshots

Run the manual `Mobile Store Screenshots` workflow after any material mobile UI
change. Its `iphone/` artifact contains five 1284x2778 screenshots accepted by
the 6.5-inch and 6.7-inch iPhone display slots, and its `ipad/` artifact
contains five 2064x2752 screenshots for the 13-inch iPad display class. Both
are captured from the same authenticated Kall mobile flow as the Android
listing set.

`npm run validate:ios-alpha` rejects a stored screenshot that drifts from
either exact App Store size.

These listing screenshots demonstrate applications, application review, the
morning brief, opportunities, and growth. The sign-in screen is deliberately
excluded: Guideline 2.3.3 requires App Store screenshots to show the app in
use, not the title art, login page, or splash screen, and the earlier set led
with a sign-in shot. Upload these five in file-name order; the App Store
accepts up to ten per display class, so no filler is needed. They do not
substitute
for the separate Plus and Premium subscription review screenshots. Capture
those only after RevenueCat products and offerings are live in a sandbox build,
so the submitted artwork shows the actual native purchase screen and price.

## Native simulator capture through Expo

Run the manual `Capture iOS store assets` EAS workflow when App Review needs a
native launch recording or an App Store-sized sign-in screenshot:

```sh
npx eas-cli@latest workflow:run .eas/workflows/capture-ios-store-assets.yml --wait
```

The workflow reuses the approved iOS 1.2.0 (21) simulator build instead of
spending another iOS build credit. It uses a custom `macos-medium` job and the
open-source Maestro CLI, so it does not require Expo's paid packaged Maestro
job. The resulting `kall-ios-store-capture` artifact contains a H.264 MP4, an
Apple-accepted 6.9-inch PNG, and a nonsecret provenance manifest.

After downloading the artifact, validate its exact contents before using it in
the submission package:

```sh
npm run validate:ios-simulator-evidence -- --evidence-dir <store-capture-output>
```

The validator checks the submitted version and build, EAS build identity,
simulator device/runtime labels, App Store screenshot dimensions, MP4
container, byte counts, and SHA-256 hashes. It also requires the manifest to
state that the media is simulator-only and writes a separate hashed validation
report. This gate cannot satisfy or be substituted for the physical-device
validator below.

This media is simulator evidence. It demonstrates native launch and the
signed-out sign-in screen; it does not prove physical-device behavior,
authentication completion, account deletion, or native purchases. Keep using
the authenticated listing screenshots above for the public App Store gallery.

## Authenticated App Review capture

Run `.eas/workflows/capture-ios-review-evidence.yml` after storing
`KALL_REVIEW_EMAIL` and the sensitive `KALL_REVIEW_PASSWORD` in the EAS
production environment. It reuses the submitted 1.2.0 (21) simulator build
and records the reviewer journey through Today, job and consulting search,
applications, live Apple-backed plans, restore controls, and the account
deletion screen.

The workflow never records the password as an artifact, confirms no purchase,
and does not delete the reusable reviewer account. Its manifest labels the
result as simulator evidence. Do not describe it to Apple as a physical-device
recording.

## Submission evidence gate

Use `review-notes-draft.md` as the truthful App Review notes source and
`review-evidence-shot-list.md` for the recording and subscription screenshot
sequence. The notes deliberately do not claim an attachment exists. Replace the
pending-evidence sentence only after the physical-device recording and both
subscription screenshots are present in App Store Connect and visually checked.

Run the deterministic source preflight before every submission:

```sh
npm run validate:ios-review
npm run validate:ios-iap-review
npm run validate:ios-review-access
```

The IAP review preflight checks the source-only contract in
`subscription-review-contract.json`: submitted version/build, bundle ID, both
Apple product IDs, entitlement and offering package names, localized-price
rendering, StoreKit purchase and restore controls, Clerk-to-RevenueCat identity,
server parameter wiring, and the current missing-media flags. It deliberately
does not call RevenueCat or App Store Connect and cannot prove provider state,
a sandbox purchase, an upload, review, or acceptance.

The reviewer-access preflight reads the nonsecret field-presence snapshot in
`review-access-status.json`. It rejects partial username/password setup, claims
that absent credentials are already stored, credentials or email addresses in
review drafts, and copy that implies an uncreated reviewer identity is ready.
It does not store credentials or prove they work; update the snapshot only after
directly rechecking App Store Connect, production Clerk, and EAS.

After collecting real physical-device media, place the three files and a copy
of `capture-metadata.example.json` in an ignored evidence directory, rename the
metadata copy to `capture-metadata.json`, fill in the capture facts, and run:

```sh
node scripts/validate-ios-review-evidence.mjs --evidence-dir <directory>
```

The validator rejects simulator metadata, a version/build mismatch, unsupported
iPhone screenshot dimensions, missing files, an invalid MP4 container, and notes
that claim absent App Store Connect attachments. It writes a hashed nonsecret
manifest beside the validated media. Passing this local check does not prove an
upload or Apple acceptance.
