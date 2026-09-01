import { test, expect, type Page } from '@playwright/test';
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright';

/**
 * Baseline coverage for the mobile app's Expo web build: sign in as a
 * pre-provisioned invite-only user, land on the signed-in tab navigator, and
 * confirm each of the five tabs actually
 * renders its own screen (not a blank view or a crash) before signing out
 * and confirming the app returns to the signed-out auth stack.
 *
 * react-native-web renders Pressable as a plain clickable <div>/<span>
 * with no ARIA button role and no accessible name by default, so this
 * clicks on visible Text content (page.getByText(...).click()) rather
 * than page.getByRole('button', ...) -- that's the reliable pattern for
 * driving RN-web from Playwright, not a workaround for a bug.
 *
 * Identity is Clerk's, so this drives a real dev instance. Public sign-up is
 * deliberately disabled for the invite-only release. The test provisions a
 * narrow synthetic user through Clerk's development Backend API, deletes it
 * in `finally`, and uses Clerk's fixed test code when the browser needs device
 * verification.
 */
const CLERK_API = 'https://api.clerk.com/v1';
const CLERK_TEST_CODE = '424242';
const E2E_PASSWORD = 'MobileSmokeTest123!';

function secretKey(): string {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key?.startsWith('sk_test_')) {
    throw new Error('Mobile E2E requires a Clerk development secret key.');
  }
  return key;
}

async function createTestUser(): Promise<{ id: string; email: string }> {
  const email = `mobile-smoke-${Date.now()}+clerk_test@example.com`;
  const response = await fetch(`${CLERK_API}/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secretKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email_address: [email],
      password: E2E_PASSWORD,
      first_name: 'Mobile',
      last_name: 'Smoke Test',
      skip_password_checks: true,
    }),
  });
  if (!response.ok) {
    throw new Error(`Could not create a Clerk mobile test user: HTTP ${response.status}`);
  }
  return { id: ((await response.json()) as { id: string }).id, email };
}

async function deleteTestUser(id: string): Promise<void> {
  const response = await fetch(`${CLERK_API}/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${secretKey()}` },
  }).catch(() => undefined);
  if (response && !response.ok && response.status !== 404) {
    console.warn(`Could not remove Clerk mobile test user: HTTP ${response.status}`);
  }
}

async function signInProgrammatically(page: Page, email: string): Promise<void> {
  await clerk.loaded({ page });
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await clerk.signIn({
        page,
        signInParams: { strategy: 'password', identifier: email, password: E2E_PASSWORD },
      });
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

async function finishDeviceVerificationIfNeeded(page: Page): Promise<void> {
  const codeField = page.locator('input[placeholder="Verification code"]:visible');
  const applications = page.getByText('Applications', { exact: true }).first();
  await expect(codeField.or(applications)).toBeVisible({ timeout: 20_000 });
  if (await codeField.isVisible()) {
    await codeField.fill(CLERK_TEST_CODE);
    await page.getByText('Verify device').click();
  }
}

test('sign in as an invited user, browse every tab, and sign out', async ({ page }) => {
  await setupClerkTestingToken({ page });
  const user = await createTestUser();

  try {
    await page.goto('/');
    await expect(page.getByText(/Invite-only alpha/)).toBeVisible();
    await expect(page.getByText('Need an account? Create one')).toHaveCount(0);
    await signInProgrammatically(page, user.email);

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

    await test.step('Mobile password sign-in returns to the workspace', async () => {
      await page.locator('input[placeholder="Email"]:visible').fill(user.email);
      await page.locator('input[placeholder="Password"]:visible').fill(E2E_PASSWORD);
      await page.getByText('Sign in', { exact: true }).click();
      await finishDeviceVerificationIfNeeded(page);
      await expect(page.getByText('Applications', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    });
  } finally {
    await deleteTestUser(user.id);
  }
});
