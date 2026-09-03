// app.json stays the source of truth for everything except the API base
// URL, which needs to be overridable for e2e/local testing against a
// non-production backend without hand-editing app.json each time (the
// previous approach, error-prone and easy to accidentally commit).
module.exports = ({ config }) => {
  const apiBaseUrl = process.env.API_BASE_URL || config.extra.apiBaseUrl;
  const clerkPublishableKey =
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || config.extra.clerkPublishableKey;
  const isRelease = process.env.KALL_MOBILE_RELEASE === '1';
  const registrationOverride = process.env.KALL_MOBILE_ALLOW_REGISTRATION;

  // A review APK must be tied to an explicitly selected HTTPS runtime and
  // Clerk instance. This prevents a release build from quietly inheriting a
  // localhost URL or a stale CloudFront distribution from app.json.
  if (isRelease) {
    const missing = [];
    if (!process.env.API_BASE_URL) missing.push('API_BASE_URL');
    if (!process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY) {
      missing.push('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY');
    }
    if (missing.length) {
      throw new Error(`Kall mobile release build is missing ${missing.join(' and ')}`);
    }
    if (!apiBaseUrl.startsWith('https://') || !apiBaseUrl.endsWith('/api')) {
      throw new Error('API_BASE_URL must be an HTTPS URL ending in /api');
    }
  }

  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      '@clerk/expo',
      'expo-web-browser',
      ...(isRelease ? ['./plugins/with-release-signing'] : []),
    ],
    extra: {
      ...config.extra,
      apiBaseUrl,
      // The Clerk publishable key identifies an instance and is public by
      // design. Secret keys never belong in an Expo or Android build.
      clerkPublishableKey,
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
