// app.json stays the source of truth for everything except the API base
// URL, which needs to be overridable for e2e/local testing against a
// non-production backend without hand-editing app.json each time (the
// previous approach, error-prone and easy to accidentally commit).
module.exports = ({ config }) => ({
  ...config,
  plugins: [...(config.plugins ?? []), '@clerk/expo', 'expo-web-browser'],
  extra: {
    ...config.extra,
    apiBaseUrl: process.env.API_BASE_URL || config.extra.apiBaseUrl,
    // Identity lives in Clerk. The publishable key is public by design (it
    // only names the instance), so app.json carries the *development* key as
    // a default to keep local dev zero-config. A production build MUST set
    // EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY -- otherwise it ships pointing at the
    // dev Clerk instance, which fails silently rather than loudly.
    clerkPublishableKey:
      process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || config.extra.clerkPublishableKey,
  },
});
