import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.KALL_UI_PORT || 3310);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './usability-tests',
  fullyParallel: false,
  workers: 1,
  // The accessibility cases intentionally walk every primary route. A cold
  // Next.js development compile can exceed 45 seconds on CI and Windows.
  timeout: 90_000,
  expect: { timeout: 12_000 },
  use: { baseURL, trace: 'retain-on-failure' },
  reporter: 'list',
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }, { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } } }],
  webServer: { command: `node node_modules/next/dist/bin/next dev usability-fixture --hostname 127.0.0.1 --port ${port}`, url: baseURL, reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
