import { test, expect, signInAsNewUser } from './helpers';

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
  test('field-level privacy settings can be changed and encrypted profiles saved', async ({ page }) => {
    await signInAsNewUser(page, 'Privacy Billing Test');

    await page.goto('/privacy');
    await expect(page.getByText('identity.phone')).toBeVisible();
    await page.getByText('identity.phone').locator('..').getByRole('button', { name: 'Tailoring' }).click();
    await expect(page.getByText('Privacy setting saved.')).toBeVisible();

    await page.locator('input[name="country"]').fill('United States');
    await page.locator('input[name="authorization_type"]').fill('Citizen');
    await page.getByRole('button', { name: 'Save encrypted authorization' }).click();
    await expect(page.getByText('Encrypted profile saved.')).toBeVisible();
  });

  // The billing page itself is covered by plan-limits.spec.ts, against the
  // three-tier picker that replaced the single $4 upgrade button.
});
