import { defineConfig, devices } from '@playwright/test';
import { API_PORT, WEB_PORT, apiURL, backendEnv, baseURL, repoRoot } from './e2e/env';

export default defineConfig({
  testDir: './e2e',
  globalSetup: require.resolve('./e2e/global-setup'),
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
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
      env: { PORT: String(WEB_PORT), KALL_API_URL: apiURL },
      url: baseURL,
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
