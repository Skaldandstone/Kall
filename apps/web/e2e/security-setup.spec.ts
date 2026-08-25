import { test, expect } from '@playwright/test';
import { currentTotpCode } from './totp';

/**
 * Regression for "setup authenticator pulls a key rather than just being a
 * scannable QR code" -- the QR code previously never actually rendered.
 * This drives the real setup -> scan -> verify loop with a real computed
 * TOTP code, so a broken QR/secret pairing would fail here even though the
 * UI still "looks" fine.
 */
test('setting up authenticator-app 2FA renders a scannable QR code and accepts a real code', async ({ page }) => {
  const unique = Date.now();
  const email = `totp-setup-${unique}@example.com`;
  const password = 'TotpSetupTest123!';

  await page.goto('/register');
  await page.locator('input[name="full_name"]').fill('Totp Setup Test');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="password_confirmation"]').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/onboarding/);

  const dialog = page.getByRole('dialog', { name: 'Protect your Kall account' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Skip for now' }).click();

  await page.goto('/security-setup');
  await page.getByRole('button', { name: 'Set up authenticator' }).click();

  const qrImage = page.getByRole('img', { name: 'Scan with your authenticator app' });
  await expect(qrImage).toBeVisible();
  const qrSrc = await qrImage.getAttribute('src');
  expect(qrSrc).toMatch(/^data:image\/png;base64,/);

  await page.getByText("Can't scan? Enter the key manually").click();
  const secret = await page.locator('code').innerText();
  expect(secret.length).toBeGreaterThan(0);

  await page.getByPlaceholder('6-digit code').fill(currentTotpCode(secret));
  await page.getByRole('button', { name: 'Verify and enable' }).click();

  await expect(page.locator('[aria-live="polite"]')).toHaveText('Authenticator-app 2FA is enabled.');
});
