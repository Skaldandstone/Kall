import { test, expect } from '@playwright/test';

/**
 * Regression coverage for a real bug found while building this suite:
 * apps/web/app/privacy/page.tsx and apps/web/app/billing/page.tsx called
 * the backend directly at `${NEXT_PUBLIC_API_URL || 'http://localhost:8000'}`
 * instead of going through the /api/kall proxy every other authenticated
 * page uses. Per docs/AWS_DEPLOYMENT.md, the browser has no route to the
 * backend in production ("the web app never calls the API directly") --
 * these two pages would fail outright for every real user. Fixed to use
 * the same '/api/kall' proxy pattern as the rest of the app; these tests
 * would have failed against the old code (the fetches would 404/network-
 * error against a nonexistent localhost:8000).
 */
test.describe('privacy and billing', () => {
  async function registerAndDismissModal(page: import('@playwright/test').Page, email: string, password: string) {
    await page.goto('/register');
    await page.locator('input[name="full_name"]').fill('Privacy Billing Test');
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('input[name="password_confirmation"]').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/onboarding/);
    const dialog = page.getByRole('dialog', { name: 'Protect your Kall account' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Skip for now' }).click();
  }

  test('field-level privacy settings can be changed and encrypted profiles saved', async ({ page }) => {
    const unique = Date.now();
    await registerAndDismissModal(page, `privacy-${unique}@example.com`, 'PrivacyPageTest123!');

    await page.goto('/privacy');
    await expect(page.getByText('identity.phone')).toBeVisible();
    await page.getByText('identity.phone').locator('..').getByRole('button', { name: 'Tailoring' }).click();
    await expect(page.getByText('Privacy setting saved.')).toBeVisible();

    await page.locator('input[name="country"]').fill('United States');
    await page.locator('input[name="authorization_type"]').fill('Citizen');
    await page.getByRole('button', { name: 'Save encrypted authorization' }).click();
    await expect(page.getByText('Encrypted profile saved.')).toBeVisible();
  });

  test('billing shows the free plan and upgrade gracefully reports Stripe is unconfigured', async ({ page }) => {
    const unique = Date.now();
    await registerAndDismissModal(page, `billing-${unique}@example.com`, 'BillingPageTest123!');

    await page.goto('/billing');
    await expect(page.getByText('free', { exact: true })).toBeVisible();
    await expect(page.getByText(/0 applications used/)).toBeVisible();

    await page.getByRole('button', { name: 'Upgrade for $4/month' }).click();
    await expect(page.getByText('Billing is not available yet. Check Stripe configuration.')).toBeVisible();
  });
});
