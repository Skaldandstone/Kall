# Kall native billing

Kall uses Stripe Checkout and the Stripe customer portal on the web. Android and
iOS use their platform billing systems through RevenueCat. All three sources map
to the same Kall `free`, `plus`, or `premium` entitlement, and the API preserves
the highest active plan if a customer has more than one billing source.

## Security and identity contract

- The mobile SDK is configured only after Clerk resolves an authenticated user.
  The Clerk user ID is the RevenueCat App User ID across Android and iOS.
- Public RevenueCat platform SDK keys may be embedded in the relevant app build.
  RevenueCat secret keys and webhook credentials never belong in an app bundle.
- `POST /api/billing/revenuecat/webhook` is closed unless native billing is
  explicitly enabled. It requires the configured Authorization header, verifies
  a timestamped HMAC over the exact raw request body, rejects stale requests,
  validates the environment and exact product catalog, and processes event IDs
  idempotently.
- Kall stores only the provider event ID and minimized event metadata. It does
  not retain a raw store receipt or webhook body.
- Restore Purchases is available as an explicit customer action. Account changes
  use `Purchases.logIn` with the newly authenticated Clerk identity; the app does
  not silently transfer purchases to an anonymous identity.

## Catalog contract

Create two auto-renewing subscription products on each store:

| Entitlement | Google Play product and base plan | Apple product |
| --- | --- | --- |
| Plus | `kall_plus_monthly:monthly` | `com.skaldandstone.kall.plus.monthly` |
| Premium | `kall_premium_monthly:monthly` | `com.skaldandstone.kall.premium.monthly` |

The identifiers are defaults for the provider setup and may be changed before
activation, but the same exact identifiers must be configured in RevenueCat and
the production stack. Product prices, trial terms, renewal periods, storefront
availability, tax category, and required store disclosures must be reviewed in
Google Play Console and App Store Connect before submission.

## Activation order

1. Create the Android subscriptions and base plans in Google Play Console. Add
   the closed-test accounts as license testers before exercising purchases.
2. Create the Kall RevenueCat project and Android app, connect its Google Play
   service account, import the products, create Plus and Premium entitlements,
   and publish a current offering containing both packages.
3. Create a strong random webhook Authorization value and a separate signing
   secret. Store them only in the production secret record. Configure the exact
   webhook URL `https://kall.skaldandstone.com/api/billing/revenuecat/webhook`.
4. Deploy migration `20260908_0034`. Enable native billing in the production
   stack with the two Google product IDs and accepted environments
   `PRODUCTION,SANDBOX` for closed testing.
5. Add the public Android SDK key to the Android EAS build environment and set
   `KALL_MOBILE_PURCHASES_ENABLED=1`. Build and submit a new Android version.
6. Verify purchase, renewal simulation, cancellation with remaining access,
   expiration, refund, restore, duplicate webhook delivery, and cross-device
   sign-in using license-test accounts. Confirm the API reports the expected
   plan and `play_store` source without inspecting receipts or tokens.
7. Repeat the store setup for Apple after App Store Connect agreements and the
   subscription group are ready. Add the Apple public SDK key only to iOS builds,
   configure both Apple products together, and repeat sandbox/TestFlight tests.

If provider setup is incomplete, leave `EnableRevenueCatNative=false` and
`KALL_MOBILE_PURCHASES_ENABLED` unset. The mobile billing screen then sends users
to the existing web billing page rather than presenting a broken store checkout.

## Release gates

- The Google and Apple product details must match Kall's web plan descriptions.
- The store account must show active paid-app agreements and valid payout/tax
  information before a paid product is submitted.
- Test purchases must use store sandbox or license-test accounts. They do not
  prove production settlement.
- A physical Android closed-test purchase and an iOS TestFlight sandbox purchase
  remain required acceptance checks after provider activation.
