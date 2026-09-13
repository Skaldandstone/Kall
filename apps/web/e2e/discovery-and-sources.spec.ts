import { test, expect, signInAsNewUser } from './helpers';

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
    await page.getByRole('button', { name: 'Add company board' }).click();
    await expect(page.getByText('Company board added. Kall can include it in monitored searches.')).toBeVisible();
    const savedBoard = page.getByRole('listitem').filter({ hasText: 'Acme Robotics' });
    await expect(savedBoard.getByText('Acme Robotics', { exact: true })).toBeVisible();
    await expect(savedBoard.getByText('Greenhouse', { exact: true })).toBeVisible();
    await expect(savedBoard.getByText('acmerobotics', { exact: true })).toBeVisible();
  });

  await test.step('the tracked-opportunity inbox starts empty', async () => {
    await page.goto('/search?tab=discovery');
    await expect(page.getByRole('heading', { name: 'No tracked opportunities yet' })).toBeVisible();
  });

  await test.step('a running search replaces the empty state with its progress', async () => {
    // The run is intercepted rather than allowed out: this asserts what the
    // page shows while a search is open, and the comment at the top of this
    // file explains why a real board sweep must not happen here.
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/api/kall/discovery/run/**', async (route) => {
      await held;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 1, professional_profile_id: 1, started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(), providers_requested: ['greenhouse'],
          jobs_collected: 0, jobs_created: 0, matches_created: 0, errors: [], status: 'completed',
        }),
      });
    });

    await expect(page.getByRole('heading', { name: 'No matching results yet' })).toBeVisible();
    await page.getByRole('button', { name: 'Search now' }).click();

    const progress = page.locator('.search-progress');
    await expect(progress).toBeVisible();
    await expect(progress.getByText('Search running')).toBeVisible();
    await expect(progress.getByRole('heading', { name: 'Checking your configured company boards' })).toBeVisible();
    await expect(progress.getByText(/10 to 30 seconds/)).toBeVisible();
    // The stale "run a search" prompt must not sit underneath a running one.
    await expect(page.getByRole('heading', { name: 'No matching results yet' })).toHaveCount(0);

    release?.();
    await expect(progress).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'No matching results yet' })).toBeVisible();
    await page.unroute('**/api/kall/discovery/run/**');
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
