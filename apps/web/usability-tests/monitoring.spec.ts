import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/kall/me', route => route.fulfill({ json: { full_name: 'Jordan Avery', email: 'jordan@example.test' } }));
  await page.route('**/api/kall/me/professional-profiles', route => route.fulfill({ json: [{ id: 1, name: 'Quality Engineering' }] }));
});

const preferences = { email_enabled: true, push_enabled: false, delivery_mode: 'digest', digest_hour_local: 8, timezone: 'America/Los_Angeles', minimum_match_score: 60, quiet_hours_start: null, quiet_hours_end: null, email_provider_status: 'unconfigured' };
const schedule = { id: 1, professional_profile_id: 1, cadence: 'continuous', timezone: 'America/Los_Angeles', run_at_local: '08:00:00', enabled: true, max_posting_age_days: 30, monitoring_status: 'worker_disabled', email_provider_status: 'unconfigured', last_success_at: null, next_run_at: null, monitored_sources: [{ provider: 'greenhouse', company_name: 'Northstar Robotics', status: 'not_checked' }] };

test('notification mode and quiet hours persist with honest sender status', async ({ page }, testInfo) => {
  let saved = { ...preferences } as Record<string, unknown>;
  await page.route('**/api/kall/notification-preferences', async (route) => {
    if (route.request().method() === 'PUT') saved = route.request().postDataJSON();
    await route.fulfill({ json: saved });
  });
  await page.goto('/settings/notifications');
  await expect(page.getByText('Email delivery is not configured yet.', { exact: false })).toBeVisible();
  await page.getByLabel('Opportunity delivery').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByLabel('Opportunity delivery')).toHaveValue('immediate');
  await page.getByLabel('Hold email during quiet hours').check();
  await page.getByLabel('Quiet hours start').fill('21:30');
  await page.getByLabel('Quiet hours end').fill('06:30');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('main').getByText('Saved.', { exact: true })).toBeVisible();
  expect(saved.delivery_mode).toBe('immediate');
  expect(saved.quiet_hours_start).toBe('21:30');
  await page.reload();
  await expect(page.getByLabel('Quiet hours start')).toHaveValue('21:30');
  await expect(page.getByLabel('Opportunity delivery')).toHaveValue('immediate');
  const overflow = await page.evaluate(() => [...document.querySelectorAll('main *')].filter(el => el.getBoundingClientRect().right > window.innerWidth + 1).map(el => ({ tag: el.tagName, text: el.textContent?.slice(0, 45), width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right })));
  await page.screenshot({ path: testInfo.outputPath(`before-notifications-${testInfo.project.name}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), JSON.stringify(overflow)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath(`notifications-${testInfo.project.name}.png`), fullPage: true });
});

test('monitoring opt-in status and schedule values survive a save error', async ({ page }, testInfo) => {
  await page.route('**/api/kall/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/kall', '');
    if (path === '/discovery/schedules') {
      if (route.request().method() === 'POST') return route.fulfill({ status: 422, json: { detail: 'The monitoring pilot is limited to five active profiles globally.' } });
      return route.fulfill({ json: [schedule] });
    }
    if (path === '/discovery/runs' || path === '/opportunities' || path === '/jobs/feed') return route.fulfill({ json: [] });
    return route.fallback();
  });
  await page.goto('/search?tab=discovery');
  await expect(page.getByText('Pilot worker is disabled.', { exact: false })).toBeVisible();
  await expect(page.getByText('Northstar Robotics · greenhouse · not checked')).toBeVisible();
  await page.getByRole('combobox', { name: 'Cadence', exact: true }).selectOption('continuous');
  await page.getByLabel('Maximum posting age in days').fill('21');
  await page.getByRole('button', { name: 'Update schedule' }).click();
  await expect(page.getByText('The monitoring pilot is limited to five active profiles globally.')).toBeVisible();
  await expect(page.getByLabel('Maximum posting age in days')).toHaveValue('21');
  await expect(page.getByLabel('Schedule time zone')).toHaveValue('America/Los_Angeles');
  await page.getByLabel('Enable this schedule').uncheck();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.getByRole('heading', { name: 'Keep this profile monitored' }).scrollIntoViewIfNeeded();
  await page.locator('section').filter({ has: page.getByRole('heading', { name: 'Keep this profile monitored' }) }).screenshot({ path: testInfo.outputPath(`monitoring-${testInfo.project.name}.png`) });
});

test('notification load failure can retry without losing the page', async ({ page }) => {
  let fail = true;
  await page.route('**/api/kall/notification-preferences', route => route.fulfill(fail ? { status: 503, json: {} } : { json: preferences }));
  await page.goto('/settings/notifications');
  await expect(page.getByRole('main').getByText('Unable to load notification settings.', { exact: true })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByLabel('Opportunity delivery')).toBeVisible();
});
