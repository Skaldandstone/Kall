import { defineConfig, devices } from '@playwright/test';
import { API_PORT, WEB_PORT, apiURL, backendEnv, baseURL, repoRoot } from './e2e/env';

export default defineConfig({
  testDir: './e2e',
  globalSetup: require.resolve('./e2e/global-setup'),
  timeout: 60_000,
  // Assertions here almost always follow a round-trip through the Next proxy
  // to the Python backend, so Playwright's 5s default (tuned for local SPA
  // rendering) is too tight on a loaded CI runner: two specs failed on
  // "element(s) not found" for content that simply had not arrived yet.
  // Costs nothing when the app is fast -- expect() polls and returns early.
  expect: { timeout: 10_000 },
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
      command: 'npm run dev',
      cwd: __dirname,
      env: {
        PORT: String(WEB_PORT),
        KALL_API_URL: apiURL,
        // Passed explicitly so a CI run works from repository secrets, where
        // there is no .env.local for Next.js to pick these up from.
        CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ?? '',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '',
        NEXT_PUBLIC_CLERK_SIGN_IN_URL: '/sign-in',
        NEXT_PUBLIC_CLERK_SIGN_UP_URL: '/sign-up',
      },
      url: baseURL,
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
