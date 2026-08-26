import { defineConfig, devices } from '@playwright/test';

/**
 * Drives the real content script against a fixture form loaded from disk.
 * No server and no extension install: the script is injected into the page
 * with a stubbed chrome.runtime, which is enough to exercise every DOM path
 * it has -- and keeps this suite fast enough to run on every push.
 */
export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.js',
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
