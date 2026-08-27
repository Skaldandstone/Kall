import { test, expect, signInAsNewUser } from './helpers';

/**
 * There was a PUT endpoint for notification preferences and no way to read
 * them back, and no UI calling either -- a settings page could not even
 * have pre-filled a form. This is the loop closed: jobs/daily_brief.py
 * already reads these values, this is what lets a person actually set them.
 */
test('changing notification settings persists through a reload', async ({ page }) => {
  await signInAsNewUser(page, 'Notification Settings Test');
  await page.goto('/settings/notifications');

  // Defaults, since no preference row exists yet for a brand-new account.
  await expect(page.getByRole('checkbox', { name: 'Email me' })).toBeChecked();
  await expect(page.getByLabel('Send it around')).toHaveValue('8');

  await page.getByLabel('Send it around').selectOption('19');
  await page.getByLabel('In your time zone').fill('America/Los_Angeles');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Send it around')).toHaveValue('19');
  await expect(page.getByLabel('In your time zone')).toHaveValue('America/Los_Angeles');
});

test('turning email off hides the schedule fields', async ({ page }) => {
  await signInAsNewUser(page, 'Notification Toggle Test');
  await page.goto('/settings/notifications');

  await page.getByRole('checkbox', { name: 'Email me' }).uncheck();
  await expect(page.getByLabel('Send it around')).toHaveCount(0);

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  const saved = await (await page.request.get('/api/kall/notification-preferences')).json();
  expect(saved.email_enabled).toBe(false);
});
