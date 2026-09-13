// app.json stays the source of truth for everything except the API base
// URL, which needs to be overridable for e2e/local testing against a
// non-production backend without hand-editing app.json each time (the
// previous approach, error-prone and easy to accidentally commit).
module.exports = ({ config }) => {
  const apiBaseUrl = process.env.API_BASE_URL || config.extra.apiBaseUrl;
  const clerkPublishableKey =
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || config.extra.clerkPublishableKey;
  const revenueCatAndroidApiKey =
    process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY || config.extra.revenueCatAndroidApiKey;
  const revenueCatAppleApiKey =
    process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY || config.extra.revenueCatAppleApiKey;
  const purchasesEnabled = process.env.KALL_MOBILE_PURCHASES_ENABLED === '1';
  const buildPlatform = process.env.EAS_BUILD_PLATFORM;
  const appleSignInEnabled = process.env.KALL_MOBILE_APPLE_SIGN_IN_ENABLED === '1';
  const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN || config.extra?.sentryDsn;
  const isRelease = process.env.KALL_MOBILE_RELEASE === '1';
  // Only the local, sideloaded alpha-APK flow (build-alpha-apk.ps1) needs the
  // with-release-signing plugin -- it patches the generated Gradle build to
  // sign with a keystore only that script knows about. An EAS cloud build
  // (the Play Store profile) has no access to that keystore or its Gradle
  // properties and manages its own signing credentials instead; including
  // the plugin there would fail the build with "signing properties are
  // required" for a keystore that will never exist in that environment.
  const useLocalAndroidSigning = process.env.KALL_MOBILE_LOCAL_ANDROID_SIGNING === '1';
  const registrationOverride = process.env.KALL_MOBILE_ALLOW_REGISTRATION;
  const nativeE2EVersion = process.env.KALL_MOBILE_E2E_VERSION;
  if (nativeE2EVersion && !/^\d+\.\d+\.\d+$/.test(nativeE2EVersion)) {
    throw new Error('KALL_MOBILE_E2E_VERSION must be a semantic version.');
  }

  // A review APK must be tied to an explicitly selected HTTPS runtime and
  // Clerk instance. This prevents a release build from quietly inheriting a
  // localhost URL or a stale CloudFront distribution from app.json.
  if (isRelease) {
    const missing = [];
    if (!process.env.API_BASE_URL) missing.push('API_BASE_URL');
    if (!process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY) {
      missing.push('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY');
    }
    if (!process.env.EXPO_PUBLIC_SENTRY_DSN) missing.push('EXPO_PUBLIC_SENTRY_DSN');
    if (missing.length) {
      throw new Error(`Kall mobile release build is missing ${missing.join(' and ')}`);
    }
    if (!apiBaseUrl.startsWith('https://') || !apiBaseUrl.endsWith('/api')) {
      throw new Error('API_BASE_URL must be an HTTPS URL ending in /api');
    }
    if (purchasesEnabled) {
      const purchaseKeys = [];
      if ((!buildPlatform || buildPlatform === 'android') && !revenueCatAndroidApiKey) {
        purchaseKeys.push('EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY');
      }
      if (buildPlatform === 'ios' && !revenueCatAppleApiKey) {
        purchaseKeys.push('EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY');
      }
      if (!buildPlatform && !revenueCatAndroidApiKey && !revenueCatAppleApiKey) {
        purchaseKeys.splice(0, purchaseKeys.length, 'a platform RevenueCat API key');
      }
      if (purchaseKeys.length) {
        throw new Error(`Kall mobile purchases are missing ${purchaseKeys.join(' and ')}`);
      }
    }
  }

  return {
    ...config,
    version: nativeE2EVersion || config.version,
    plugins: [
      ...(config.plugins ?? []),
      '@clerk/expo',
      'expo-web-browser',
      'expo-notifications',
      ['@sentry/react-native/expo', {
        organization: 'skald-and-stone',
        project: 'kall-mobile-sp',
      }],
      ...(useLocalAndroidSigning ? ['./plugins/with-release-signing'] : []),
    ],
    extra: {
      ...config.extra,
      apiBaseUrl,
      // The Clerk publishable key identifies an instance and is public by
      // design. Secret keys never belong in an Expo or Android build.
      clerkPublishableKey,
      revenueCatAndroidApiKey,
      revenueCatAppleApiKey,
      purchasesEnabled,
      appleSignInEnabled,
      sentryDsn,
      // Kall is a public product now (the web app dropped its invite-only
      // gate the same way) -- a release build follows app.json's setting
      // like any other build. An explicit override still lets a fixture or
      // e2e run force either state regardless of build type.
      allowRegistration: registrationOverride === undefined
        ? config.extra.allowRegistration
        : registrationOverride === '1',
    },
  };
};
