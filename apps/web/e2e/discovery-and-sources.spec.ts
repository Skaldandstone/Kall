import { test, expect } from '@playwright/test';
import { signInAsNewUser } from './helpers';

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
test('adding a search source and scheduling automatic discovery', async ({ page }) => {
  await signInAsNewUser(page, 'Discovery Sources Test');

  // The schedule form (like every ProfessionalProfileSelect consumer) is
  // disabled until a professional profile exists. Create one directly rather
  // than walking the onboarding wizard, which this spec doesn't otherwise need.
  const profileResponse = await page.request.post('/api/kall/me/professional-profiles', {
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
