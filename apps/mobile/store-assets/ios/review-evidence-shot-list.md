# App Review evidence shot list

This checklist maps the remaining media directly to Apple's request. Record and
capture the submitted Kall 1.2.0 build 21 on a physical iPhone. Do not
substitute responsive web or iOS Simulator media for the physical-device
recording.

## One continuous physical-device recording

Record an iPhone screen in one uninterrupted take. Keep credentials, email
notifications, purchase receipts, device identifiers, and unrelated apps out of
frame.

1. Start on the iPhone Home Screen and launch the Kall app from its established
   icon. This proves a normal installed-binary launch.
2. After the dedicated reviewer identity and App Store Connect credentials are
   verified, show the Kall sign-in screen and sign in. Do not reveal the
   password.
3. Show Today with populated review data and one visible next action.
4. Open Work, show job search, then switch to the consulting track. This proves
   both tracks are parallel parts of the product.
5. Open Apply and show the application list and one review screen without
   submitting anything.
6. Open Growth and show one populated career-development or interview-prep
   module.
7. Open Profile, then Plan. Show both Plus and Premium with their localized
   monthly prices and the Restore purchases control.
8. Open the Plus Apple purchase sheet, show the matching product and price, and
   cancel it. Repeat for Premium. Do not complete either transaction for the
   recording.
9. Return to Profile and open account deletion through its confirmation screen.
   Cancel before deleting the reusable reviewer account.
10. Return to Today, then stop the recording.

Acceptance checks:

- The app remains responsive and no error banner, placeholder product, external
  Stripe checkout, or debug UI appears.
- The recording shows Apple, Google, and email sign-in only if each is enabled
  and functional in the submitted build.
- The Plan screen names, prices, billing periods, and purchase sheets agree.
- No application, lead message, career page, purchase, or deletion is completed.

## Plus subscription-review screenshot

Capture the native Plan screen at an App Store-supported iPhone resolution with
the Plus product fully visible. It must show:

- Kall Plus and the monthly billing period.
- The localized App Store price returned by RevenueCat.
- The native purchase action.
- Enough surrounding Kall UI to identify the screenshot as an in-app screen.

Do not use a web pricing page, mock data, a simulator-only artifact represented
as a physical capture, or an Apple purchase sheet containing account details.

## Premium subscription-review screenshot

Capture the same native Plan screen with the Premium product fully visible. It
must show:

- Kall Premium and the monthly billing period.
- The localized App Store price returned by RevenueCat.
- The native purchase action.
- Enough surrounding Kall UI to identify the screenshot as an in-app screen.

Verify that Plus and Premium use their existing product identifiers and do not
change pricing, legal text, or subscription-group membership while collecting
evidence.

## App Store Connect completion check

Before choosing Add for Review or Resubmit:

- Enter the dedicated reviewer username and password in App Store Connect and
  verify a native sign-in without MFA or a device-trust challenge.
- Upload the authenticated physical-device recording to App Review Information.
- Upload the Plus screenshot to the Plus subscription review field.
- Upload the Premium screenshot to the Premium subscription review field.
- Preview all three uploads after processing.
- Paste the final notes only after removing the pending-evidence paragraph and
  describing exactly what the uploaded recording shows.
- Keep release mode manual until review succeeds.
