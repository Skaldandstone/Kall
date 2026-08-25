import { test, expect } from '@playwright/test';
import { setupClerkTestingToken } from '@clerk/testing/playwright';

/**
 * Baseline coverage for the mobile app's Expo web build: register, land on
 * the signed-in tab navigator, and confirm each of the five tabs actually
 * renders its own screen (not a blank view or a crash) before signing out
 * and confirming the app returns to the signed-out auth stack.
 *
 * react-native-web renders Pressable as a plain clickable <div>/<span>
 * with no ARIA button role and no accessible name by default, so this
 * clicks on visible Text content (page.getByText(...).click()) rather
 * than page.getByRole('button', ...) -- that's the reliable pattern for
 * driving RN-web from Playwright, not a workaround for a bug.
 *
 * Identity is Clerk's, so this drives a real dev instance. Two Clerk test
 * conventions make that possible without a mailbox: a `+clerk_test` address
 * accepts the fixed verification code below, and setupClerkTestingToken gets
 * the sign-up past bot protection.
 */
const CLERK_TEST_CODE = '424242';

test('register, browse every tab, and sign out', async ({ page }) => {
  await setupClerkTestingToken({ page });

  const unique = Date.now();
  const email = `mobile-smoke-${unique}+clerk_test@example.com`;
  const password = 'MobileSmokeTest123!';

  await page.goto('/');
  await page.getByText('Need an account? Create one').click();

  // The native-stack navigator keeps the previous screen mounted (off-
  // screen) for its transition, even on web -- so Login's own "Email"
  // field is still in the DOM alongside Register's. Scope to what's
  // actually visible rather than assuming only one screen is mounted.
  await page.locator('input[placeholder="Full name"]:visible').fill('Mobile Smoke Test');
  await page.locator('input[placeholder="Email"]:visible').fill(email);
  await page.locator('input[placeholder="Password"]:visible').fill(password);
  await page.getByText('Create account').click();

  await test.step('Clerk verifies the email address', async () => {
    const codeField = page.locator('input[placeholder="Verification code"]:visible');
    await expect(codeField).toBeVisible({ timeout: 20_000 });
    await codeField.fill(CLERK_TEST_CODE);
    await page.getByText('Verify email').click();
  });

  await test.step('Applications tab renders by default', async () => {
    await expect(page.getByText('Applications', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Review and approve what Kall has prepared.')).toBeVisible();
  });

  await test.step('Opportunities tab renders', async () => {
    await page.getByText('Opportunities', { exact: true }).click();
    await expect(page.getByText('Search the boards Kall watches for you.')).toBeVisible();
  });

  await test.step('Growth tab renders', async () => {
    await page.getByText('Growth', { exact: true }).click();
    await expect(page.getByText('Turn a career goal into a step-by-step plan.')).toBeVisible();
  });

  await test.step('Brief tab renders', async () => {
    await page.getByText('Brief', { exact: true }).click();
    await expect(page.getByText(/Good morning|Morning Brief/).first()).toBeVisible();
  });

  await test.step('Profile tab renders and signs out', async () => {
    await page.getByText('Profile', { exact: true }).click();
    await expect(page.getByText('Manage professional profiles, resumes, and growth goals from the Kall web app.')).toBeVisible();
    await page.getByText('Sign out').click();
    await expect(page.getByText('Sign in to your career workspace.')).toBeVisible();
  });
});
