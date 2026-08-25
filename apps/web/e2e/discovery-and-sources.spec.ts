import { test, expect } from '@playwright/test';

/**
 * Covers the Opportunities workspace's non-live-network surface: adding a
 * company job board (Sources tab), scheduling automatic discovery, and the
 * tracked-opportunity inbox's empty state (Tracked tab). Deliberately does
 * NOT click "Search now" against a made-up company board -- that makes a
 * real outbound HTTP call to Greenhouse/Lever/Ashby (see
 * backend/kall/services/discovery.py's run_discovery), which is slow,
 * flaky, and unavailable in a sandboxed CI runner. The discovery pipeline
 * itself (including the tracked-opportunity-inbox regression from this
 * session) is already covered by tests/test_opportunities.py with a fake
 * provider; this spec only exercises the UI around it.
 */
test('adding a search source and scheduling automatic discovery', async ({ page, request, baseURL }) => {
  const unique = Date.now();
  const email = `discovery-${unique}@example.com`;
  const password = 'DiscoverySourcesTest123!';

  await page.goto('/register');
  await page.locator('input[name="full_name"]').fill('Discovery Sources Test');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="password_confirmation"]').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/onboarding/);

  const dialog = page.getByRole('dialog', { name: 'Protect your Kall account' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Skip for now' }).click();

  // The schedule form (like every ProfessionalProfileSelect consumer) is
  // disabled until a professional profile exists. Create one directly
  // rather than walking the full onboarding wizard, which this spec
  // doesn't otherwise need.
  const token = await page.evaluate(() => localStorage.getItem('kall_token'));
  const profileResponse = await request.post(`${baseURL}/api/kall/me/professional-profiles`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Backend Leadership', target_titles: ['Senior Backend Engineer'] },
  });
  expect(profileResponse.ok()).toBeTruthy();

  await test.step('add a company job board under Sources', async () => {
    await page.goto('/search?tab=sources');
    await page.locator('select[name="provider"]').selectOption('greenhouse');
    await page.locator('input[name="company"]').fill('Acme Robotics');
    await page.locator('input[name="board_key"]').fill('acmerobotics');
    await page.getByRole('button', { name: 'Add source' }).click();
    await expect(page.getByText('Source added.')).toBeVisible();
    await expect(page.getByText('Acme Robotics · greenhouse · acmerobotics')).toBeVisible();
  });

  await test.step('the tracked-opportunity inbox starts empty', async () => {
    await page.goto('/search?tab=discovery');
    await expect(page.getByRole('heading', { name: 'No tracked opportunities yet' })).toBeVisible();
  });

  await test.step('save an automatic discovery schedule', async () => {
    await expect(page.getByRole('button', { name: 'Save schedule' })).toBeEnabled();
    await page.locator('select[name="cadence"]').selectOption('weekly');
    await page.locator('input[name="hour_local"]').fill('9');
    await page.locator('input[name="age_days"]').fill('14');
    await page.getByRole('button', { name: 'Save schedule' }).click();
    await expect(page.getByText('Automatic discovery schedule saved.')).toBeVisible();
    await expect(page.getByText(/Current schedule: weekly at 09:00/)).toBeVisible();
  });
});
