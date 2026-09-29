# Kall 1.2.0 (21) physical App Review capture script

Use this runbook only with the submitted TestFlight build **Kall 1.2.0 (21)**
installed on a physical iPhone or iPad. The recording and screenshots are review
evidence, not marketing artwork. Do not substitute Simulator, responsive web,
or the existing public-listing screenshots.

## Stop conditions

Stop without recording or taking screenshots if any of these checks fail:

- TestFlight does not identify the installed build as **1.2.0 (21)**.
- The dedicated disposable reviewer identity cannot sign in without MFA, a
  verification code, or a device-trust challenge.
- **Profile > Plan and billing** shows “Plan changes are not available in the
  app yet,” “No mobile subscription options are available right now,” an error
  banner, a placeholder product, or an external checkout link.
- The native plan screen does not show both **Kall Plus** and **Kall Premium**,
  each with an App Store localized price and a `Choose …` purchase action.
- **Restore purchases** is absent.
- The Plus or Premium Apple purchase sheet disagrees with the product or price
  shown by Kall.
- Any password, verification code, receipt, unrelated notification, personal
  Apple Account detail, or another person's data would be captured.

Record the failed prerequisite separately. Do not work around it in the media,
change provider configuration during capture, or describe it as passing.

## Device preparation

1. Confirm the device is physical and note its model and iOS/iPadOS version.
2. Enable Do Not Disturb, close unrelated apps, clear visible notifications,
   and use portrait orientation unless the current iPad layout requires
   landscape to show the complete plan card.
3. Confirm the disposable review account contains seeded, nonpersonal examples
   for Today, job search, consulting, applications, and Growth.
4. Sign out of Kall. Keep the reviewer email available for autofill and ensure
   the password and any one-time code will never appear in the recording.
5. Confirm screen recording is set to device audio only and microphone off.
6. Start from the Home Screen with the established Kall icon visible.

## One continuous recording

Create `kall-ios-physical-review.mp4` in one uninterrupted take.

1. Start recording, launch **Kall**, and show the `Welcome back` screen.
2. Sign in with the dedicated reviewer identity using `Sign in`. The password
   must remain obscured. If `Confirm this device`, `Verification code`, or
   `Verify device` appears, stop: the reviewer account is not ready.
3. On **Today**, show `Your daily brief`, one `Next best action`, and the
   populated `Applications` or `Top opportunities` section.
4. Open **Work**. Show the **Job search** track, then select **Consulting**.
   Show only seeded examples; do not create a lead or send a message.
5. Open **Apply**. Show `Applications`, open one seeded application, and show
   its review state. Do not approve or submit anything.
6. Open **Growth** and show one populated career-development or interview-prep
   module. Do not generate a paid AI result during capture.
7. Open **Profile**, then **Plan and billing**. Pause long enough to show:
   - **Kall Plus**, its localized monthly App Store price, and `Choose Kall Plus`;
   - **Kall Premium**, its localized monthly App Store price, and
     `Choose Kall Premium`;
   - **Restore purchases**; and
   - the native renewal and cancellation disclosure.
8. Tap `Choose Kall Plus`. Show Apple's native confirmation sheet with the
   matching product and price, then cancel. Do not complete a purchase.
9. Tap `Choose Kall Premium`. Show Apple's native confirmation sheet with the
   matching product and price, then cancel. Do not complete a purchase.
10. Return to **Profile**, select `Delete my account`, and show the screen headed
    `This cannot be undone`, the email-confirmation field, and the disabled
    `Permanently delete my account` action. Do not type the confirmation email
    and do not delete the account.
11. Return to **Today**, show the app remains responsive, and stop recording.

The recording must not complete a purchase, submit an application, contact a
consulting lead, publish a career page, or delete the reviewer account.

## Separate subscription review screenshots

Take two distinct device-native PNG screenshots from **Profile > Plan and
billing**. Apple allows an in-app-purchase review screenshot that meets any App
Store screenshot specification supported by the app, including supported iPad
dimensions. Do not resize an unsupported raw capture to force validation.

### `plus-subscription-review.png`

Frame the screen so **Kall Plus**, the localized App Store price, and the
`Choose Kall Plus` action are fully visible with enough Kall navigation or
surrounding UI to establish that this is the native app. Do not include an
Apple confirmation sheet or account details.

Expected Apple product ID for the visual-review record:
`com.skaldandstone.kall.plus.monthly`.

### `premium-subscription-review.png`

Frame the screen so **Kall Premium**, the localized App Store price, and the
`Choose Kall Premium` action are fully visible with enough Kall navigation or
surrounding UI to establish that this is the native app. Do not include an
Apple confirmation sheet or account details.

Expected Apple product ID for the visual-review record:
`com.skaldandstone.kall.premium.monthly`.

## Package and validate

Place the recording and both screenshots in one local evidence directory. Copy
`capture-metadata.example.json` to `capture-metadata.json` in that directory
and enter only nonsecret observed facts. Do not set a visual-review boolean to
true until the owner has inspected the actual media.

Run:

```sh
npm run validate:ios-physical-capture-script
node scripts/validate-ios-review-evidence.mjs --evidence-dir <evidence-directory>
```

The first command proves this runbook still matches source labels and routes.
The second checks package structure, submitted version/build, product metadata,
supported screenshot dimensions, distinct images, MP4 container, and hashes.
This validation does not prove TestFlight installation, successful sign-in, a
sandbox purchase, App Store Connect upload, review, or acceptance.

## Provider handoff after capture

Only after local validation and owner visual review:

1. Upload the recording to App Review Information.
2. Upload the Plus PNG to the Plus subscription review screenshot field.
3. Upload the Premium PNG to the Premium subscription review screenshot field.
4. Preview all three processed assets in App Store Connect.
5. Recheck the dedicated reviewer username and password fields without copying
   credentials into source or notes.
6. Finalize reviewer notes against the exact submitted build and evidence.
7. Keep manual release selected until review succeeds.

Do not mark any provider status file complete before its matching live evidence
has been rechecked.
