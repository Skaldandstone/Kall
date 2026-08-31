import { test, expect } from '@playwright/test';

const usage = { plan: 'free', billing_exempt: false, meters: {
  applications: { used: 2, limit: 5, remaining: 3, period: 'week' },
  ai_actions: { used: 1, limit: 3, remaining: 2, period: 'week' },
} };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/kall/me/usage', route => route.fulfill({ json: usage }));
});

test('disabled billing is visible without starting Checkout', async ({ page }, testInfo) => {
  let attempts = 0;
  await page.route('**/api/kall/billing/status', route => route.fulfill({ json: { enabled: false, can_manage: false } }));
  await page.route('**/api/kall/billing/checkout', route => { attempts += 1; return route.fulfill({ status: 503, json: {} }); });
  await page.goto('/billing');
  await expect(page.getByText('Payments are not switched on.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose Plus', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Choose Premium', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Refresh usage', exact: true }).click();
  expect(attempts).toBe(0);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath(`billing-disabled-${testInfo.project.name}.png`), fullPage: true });
});

test('return does not claim payment and ambiguous failures preserve recovery', async ({ page }, testInfo) => {
  let calls = 0;
  await page.route('**/api/kall/billing/status', route => route.fulfill({ json: { enabled: true, can_manage: true } }));
  await page.route('**/api/kall/billing/checkout', async route => {
    calls += 1;
    expect(route.request().postDataJSON()).toEqual({ plan: 'plus' });
    await route.fulfill({ status: 503, json: { detail: 'Synthetic provider timeout' } });
  });
  await page.route('**/api/kall/billing/portal', route => route.fulfill({ status: 503, json: {} }));
  await page.goto('/billing?checkout=returned');
  await expect(page.getByRole('status')).toContainText('Your plan changes only after payment confirmation');
  await page.getByRole('button', { name: 'Choose Plus', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('resume the same attempt');
  await expect(page.getByText('Nothing has been charged.', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Manage billing', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Choose Plus', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => calls).toBe(2);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath(`billing-recovery-${testInfo.project.name}.png`), fullPage: true });
});

test('status load failure keeps purchase closed and permits retry', async ({ page }) => {
  let failure = true;
  await page.route('**/api/kall/billing/status', route => route.fulfill(failure
    ? { status: 503, json: {} } : { json: { enabled: true, can_manage: false } }));
  await page.goto('/billing');
  await expect(page.getByRole('status')).toContainText('Could not load billing details');
  await expect(page.getByRole('button', { name: 'Choose Plus', exact: true })).toBeDisabled();
  failure = false;
  await page.getByRole('button', { name: 'Refresh usage', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose Plus', exact: true })).toBeEnabled();
  await expect(page.getByRole('status')).toHaveCount(0);
});
