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
   secret. Store them only in the production secret record, as JSON keys
   `REVENUECAT_WEBHOOK_AUTHORIZATION` and `REVENUECAT_WEBHOOK_SIGNING_SECRET`,
   alongside `REVENUECAT_SECRET_API_KEY`, the RevenueCat secret API key the
   staff portal uses to refund and revoke Google Play subscriptions
   (`/api/admin/portal/users/{id}/store-refund`, via RevenueCat's revoke
   call). Apple refunds are never issued by Kall; the portal shows the
   customer-facing steps instead. Configure the exact
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
`KALL_MOBILE_PURCHASES_ENABLED` unset. The mobile billing screen then stays
read-only: it shows the plan and usage the account already has and deliberately
does not link out to web billing, because Google Play and the App Store both
prohibit pointing an app at an external checkout for a digital subscription.

## Provider checkpoint: 10 September 2026

- Stripe web billing is live with the Kall-only Plus and Premium monthly catalog
  at USD 5 and USD 15.
- Google Play contains the `kall_plus_monthly` and `kall_premium_monthly`
  subscription records and reviewed customer-facing metadata. Both `monthly`
  base plans are saved and active, available in the United States and Canada
  only for launch: Plus at USD 4.99 / CAD 6.99 and Premium at USD 14.99 /
  CAD 20.99. Each is monthly auto-renewing with a 7-day grace period and the
  automatically calculated account hold. The earlier generic save failure was
  caused by saving before any regional price existed; set prices first, then
  save, then activate. Plus retains stored prices for the other regions so they
  can be re-added without re-entry when availability widens.
- App Store Connect subscription group `22370361` contains
  `com.skaldandstone.kall.plus.monthly` at USD 4.99 and
  `com.skaldandstone.kall.premium.monthly` at USD 14.99. Both are in Prepare for
  Submission. Paid-app banking, tax, and trader information and review
  screenshots remain incomplete.
- RevenueCat project `b4b5bad9` contains Android and App Store app records and
  the `plus` and `premium` entitlements. The App Store record validates the
  dedicated in-app purchase key. Its authenticated, HMAC-signed production
  webhook is configured for production and sandbox events. The dedicated
  webhook secret is stored in AWS Secrets Manager; native billing remains
  disabled in the production stack.
- EAS production now contains both public RevenueCat platform SDK keys. Do not
  enable purchases or create a purchases-enabled replacement store build until
  the store connections, product imports, and offering are complete. RevenueCat
  still needs a dedicated App Store Connect API key for product import and price
  tracking.
- Google Cloud has Android Publisher, Play Developer Reporting, and Pub/Sub APIs
  enabled and a dedicated `kall-revenuecat` service account with Pub/Sub Editor
  and Monitoring Viewer. On 10 September 2026 a temporary project-scoped
  override of `iam.managed.disableServiceAccountKeyCreation` allowed one JSON
  key (ID `068415d4ee256b20a5f89984d8a9e26683311046`, no expiry) to be created
  for it; the override was reverted the same session and the project reads
  Enforced again. The service account is invited to Play Console with app-level
  view-app-information, view-financial-data, and manage-orders permissions on
  Kall only. RevenueCat validates the credentials. Real-time developer
  notifications are enabled in Play Console Monetization setup on
  `projects/kall-production/topics/Play-Store-Notifications`.
- Clerk production has both Android and iOS native applications registered. The
  Apple Services ID and callback domain exist, but Apple sign-in remains disabled
  until the exposed one-time Apple key is revoked and replaced safely.
- The manual `Mobile Store Screenshots` workflow captures the current public
  registration flow and authenticated product screens at Google Play phone,
  App Store iPhone 6.7-inch, and App Store iPad 13-inch dimensions. Listing
  uploads remain a provider-side release action after visual review. Subscription
  review screenshots remain separate and require a working native sandbox
  purchase screen.

## Release gates

- The Google and Apple product details must match Kall's web plan descriptions.
- The store account must show active paid-app agreements and valid payout/tax
  information before a paid product is submitted.
- Test purchases must use store sandbox or license-test accounts. They do not
  prove production settlement.
- A physical Android closed-test purchase and an iOS TestFlight sandbox purchase
  remain required acceptance checks after provider activation.
