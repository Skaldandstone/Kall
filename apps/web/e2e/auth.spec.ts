import { test, expect } from '@playwright/test';

/**
 * Session lifecycle coverage: sign-up, sign-out, sign back in, a rejected
 * password, and an anonymous visit to a protected page. These are the exact
 * seams a "users get logged out too easily" style report comes from, so this
 * exists to catch a regression there before a user does.
 */
test.describe('authentication', () => {
  test('register, sign out, and sign back in', async ({ page }) => {
    const unique = Date.now();
    const email = `auth-roundtrip-${unique}@example.com`;
    const password = 'AuthRoundTrip123!';

    await test.step('register', async () => {
      await page.goto('/register');
      await page.locator('input[name="full_name"]').fill('Auth Roundtrip Test');
      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="password"]').fill(password);
      await page.locator('input[name="password_confirmation"]').fill(password);
      await page.getByRole('button', { name: 'Create account' }).click();
      await expect(page).toHaveURL(/\/onboarding/);
    });

    const firstToken = await page.evaluate(() => localStorage.getItem('kall_token'));
    expect(firstToken).toBeTruthy();

    await test.step('dismiss the post-signup security setup modal', async () => {
      const dialog = page.getByRole('dialog', { name: 'Protect your Kall account' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Skip for now' }).click();
    });

    await test.step('sign out from settings', async () => {
      await page.goto('/settings');
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page).toHaveURL(/\/login/);
      const tokenAfterSignOut = await page.evaluate(() => localStorage.getItem('kall_token'));
      expect(tokenAfterSignOut).toBeNull();
    });

    await test.step('the old token is rejected server-side, not just forgotten client-side', async () => {
      const response = await page.evaluate(async (token) => {
        const result = await fetch('/api/kall/me', { headers: { Authorization: `Bearer ${token}` } });
        return result.status;
      }, firstToken);
      expect(response).toBe(401);
    });

    await test.step('a signed-out visitor sees a sign-in prompt, not application data', async () => {
      await page.goto('/applications');
      await expect(page.getByRole('heading', { name: 'Sign in to view your applications.' })).toBeVisible();
    });

    await test.step('sign back in with the same credentials', async () => {
      await page.goto('/login');
      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole('button', { name: 'Log in', exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard/);
    });

    const secondToken = await page.evaluate(() => localStorage.getItem('kall_token'));
    expect(secondToken).toBeTruthy();
    expect(secondToken).not.toBe(firstToken);
  });

  test('a wrong password is rejected without creating a session', async ({ page, request, baseURL }) => {
    const unique = Date.now();
    const email = `auth-wrongpass-${unique}@example.com`;
    const password = 'CorrectPassword123!';

    const registerResponse = await request.post(`${baseURL}/api/kall/auth/register`, {
      data: { email, password, full_name: 'Wrong Password Test' },
    });
    expect(registerResponse.ok()).toBeTruthy();

    await page.goto('/login');
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill('DefinitelyWrongPassword!');
    await page.getByRole('button', { name: 'Log in', exact: true }).click();

    await expect(page.getByText('Invalid credentials')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    const token = await page.evaluate(() => localStorage.getItem('kall_token'));
    expect(token).toBeNull();
  });
});
