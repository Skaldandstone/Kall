import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright';
import { backendEnv, mobileRoot, repoRoot } from './env';

/**
 * Captures Google Play Store listing screenshots against a real (throwaway)
 * Clerk test account and a real local backend -- not mockups. On demand
 * only (guarded below): this isn't a correctness check, so it has no
 * business running on every push the way smoke.spec.ts does.
 *
 * Drives the same Expo web build the rest of apps/mobile/e2e/ uses, signs in
 * as a synthetic "John Kall" user provisioned through Clerk's development
 * Backend API (deleted in `finally`, same pattern as smoke.spec.ts), then
 * seeds a couple of realistic applications directly through the ORM (see
 * seed_screenshot_data.py) since there is no API for fabricating pipeline
 * data and driving the full tailoring pipeline through the web UI is out of
 * scope for a one-off asset-generation script.
 */
test.skip(
  process.env.CAPTURE_STORE_SCREENSHOTS !== '1',
  'Screenshot capture runs only when explicitly requested (see .github/workflows/mobile-store-screenshots.yml).',
);

const CLERK_API = 'https://api.clerk.com/v1';
const CLERK_TEST_CODE = '424242';
const E2E_PASSWORD = 'MobileScreenshot123!';
const supportedScreenshotTargets = ['android', 'iphone', 'ipad'] as const;
type ScreenshotTarget = (typeof supportedScreenshotTargets)[number];
const requestedScreenshotTarget = process.env.STORE_SCREENSHOT_TARGET ?? 'android';
if (!supportedScreenshotTargets.includes(requestedScreenshotTarget as ScreenshotTarget)) {
  throw new Error(`Unsupported store screenshot target: ${requestedScreenshotTarget}`);
}
const screenshotTarget = requestedScreenshotTarget as ScreenshotTarget;
const OUTPUT_DIR = path.join(mobileRoot, 'e2e', 'screenshots', screenshotTarget);

function secretKey(): string {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key?.startsWith('sk_test_')) {
    throw new Error('Screenshot capture requires a Clerk development secret key.');
  }
  return key;
}

async function createTestUser(): Promise<{ id: string; email: string }> {
  const email = `john-kall-screenshots-${Date.now()}+clerk_test@example.com`;
  const response = await fetch(`${CLERK_API}/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secretKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email_address: [email],
      password: E2E_PASSWORD,
      first_name: 'John',
      last_name: 'Kall',
      skip_password_checks: true,
    }),
  });
  if (!response.ok) {
    throw new Error(`Could not create the John Kall Clerk test user: HTTP ${response.status}`);
  }
  return { id: ((await response.json()) as { id: string }).id, email };
}

async function deleteTestUser(id: string): Promise<void> {
  const response = await fetch(`${CLERK_API}/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${secretKey()}` },
  }).catch(() => undefined);
  if (response && !response.ok && response.status !== 404) {
    console.warn(`Could not remove the John Kall Clerk test user: HTTP ${response.status}`);
  }
}

async function signIn(page: Page, email: string): Promise<void> {
  await clerk.loaded({ page });
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await clerk.signIn({ page, signInParams: { strategy: 'password', identifier: email, password: E2E_PASSWORD } });
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      if (!/Couldn't find your account/i.test(String(error))) throw error;
      await page.waitForTimeout(1_000 * (attempt + 1));
    }
  }
  if (lastError) throw lastError;

  await page.evaluate(async (code) => {
    const clerkClient = (window as { Clerk?: any }).Clerk;
    const signIn = clerkClient?.client?.signIn;
    if (!signIn || signIn.status === 'complete') return;
    await signIn.prepareSecondFactor({ strategy: 'email_code' });
    const result = await signIn.attemptSecondFactor({ strategy: 'email_code', code });
    if (result?.createdSessionId) await clerkClient.setActive({ session: result.createdSessionId });
  }, CLERK_TEST_CODE);
}

function seedApplications(email: string): void {
  execFileSync(
    'python',
    [path.join(mobileRoot, 'e2e', 'seed_screenshot_data.py'), '--email', email],
    { cwd: repoRoot, env: { ...process.env, ...backendEnv }, stdio: 'inherit' },
  );
}

test.use({
  viewport: screenshotTarget === 'iphone'
    ? { width: 430, height: 932 }
    : screenshotTarget === 'ipad'
      ? { width: 1032, height: 1376 }
      : { width: 360, height: 640 },
  deviceScaleFactor: screenshotTarget === 'ipad' ? 2 : 3,
  isMobile: true,
  hasTouch: true,
});

test(`capture ${screenshotTarget} store screenshots as John Kall`, async ({ page }) => {
  test.setTimeout(120_000);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  await setupClerkTestingToken({ page });
  const user = await createTestUser();

  try {
    await page.goto('/');
    await expect(page.getByText('Need an account? Create one')).toBeVisible();
    await page.screenshot({ path: path.join(OUTPUT_DIR, '1-sign-in.png') });

    await signIn(page, user.email);
    await expect(page.getByText('Today', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Good morning/).first()).toBeVisible({ timeout: 20_000 });

    seedApplications(user.email);
    await page.getByRole('tab', { name: 'Applications' }).click();
    await expect(page.getByText('Anchor Robotics')).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: path.join(OUTPUT_DIR, '2-applications.png') });

    await page.getByText('Senior Backend Engineer').click();
    await expect(page.getByText('Review checklist', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Review required: Why are you interested in this role?')).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUTPUT_DIR, '3-application-review.png') });
    await page.getByRole('tab', { name: 'Today' }).click();
    await expect(page.getByText(/Good morning/).first()).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: path.join(OUTPUT_DIR, '4-morning-brief.png') });

    await page.getByRole('tab', { name: 'Job search and consulting' }).click();
    await expect(page.getByText('Kall scans your sources and brings the strongest matches here.')).toBeVisible();
    await page.screenshot({ path: path.join(OUTPUT_DIR, '5-opportunities.png') });

    await page.getByRole('tab', { name: 'Growth' }).click();
    await expect(page.getByText('A practical plan shaped around where you want to go next.')).toBeVisible();
    await page.screenshot({ path: path.join(OUTPUT_DIR, '6-growth.png') });
  } finally {
    await deleteTestUser(user.id);
  }
});
