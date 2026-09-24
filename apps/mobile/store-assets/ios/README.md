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
