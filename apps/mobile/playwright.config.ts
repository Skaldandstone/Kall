import { defineConfig, devices } from '@playwright/test';
import { API_PORT, WEB_PORT, apiURL, backendEnv, baseURL, repoRoot } from './e2e/env';

/**
 * Drives the mobile app's Expo web build with Playwright -- there's no
 * Android/iOS emulator available in this environment (or most CI runners
 * without extra setup), so this covers what react-native-web actually
 * renders rather than true native behavior. app.config.js's API_BASE_URL
 * override points the app at this run's own local backend instead of the
 * Android-emulator development URL in app.json.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: require.resolve('./e2e/global-setup'),
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['junit', { outputFile: 'junit.xml' }]]
    : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `python -m uvicorn kall.main:app --host 127.0.0.1 --port ${API_PORT}`,
      cwd: repoRoot,
      env: backendEnv,
      url: `${apiURL}/docs`,
      timeout: 30_000,
      reuseExistingServer: false,
    },
    {
      // --clear is required: Metro/Expo caches the evaluated app.config.js
      // (including API_BASE_URL) across runs, so a plain `expo start` can
      // silently reuse a stale apiBaseUrl from a previous invocation with a
      // different env var value.
      command: `npx expo start --web --port ${WEB_PORT} --clear`,
      cwd: __dirname,
      env: {
        API_BASE_URL: `${apiURL}/api`,
        CI: '1',
        // app.config.js reads this to hand ClerkProvider its key; without it
        // the app boots signed-out with no way to sign in.
        EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '',
        // The first production release is invite-only. The browser fixture
        // must cover that screen even though ordinary local development keeps
        // app.json's account-creation convenience enabled.
        KALL_MOBILE_ALLOW_REGISTRATION: '0',
      },
      url: baseURL,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
