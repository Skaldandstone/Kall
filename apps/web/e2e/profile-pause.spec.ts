import { test, expect, signInAsNewUser } from './helpers';

/**
 * Pausing a career profile.
 *
 * Reported directly: there was no way to remove a profile from the Strategy
 * tab. There is a real is_active flag already wired into resume-intelligence
 * matching, and the UI already had copy for "Paused profile" -- but no
 * control ever set it, and the edit form's save() hardcoded is_active: true
 * on every save, which would have silently reactivated a paused profile the
 * next time anyone touched it.
 */
test('pausing and reactivating a profile actually persists, including through an edit', async ({ page }) => {
  await signInAsNewUser(page, 'Pause Profile Test');

  const created = await page.request.post('/api/kall/me/professional-profiles', {
    data: { name: 'Backend Leadership', target_titles: ['Senior Backend Engineer'] },
  });
  expect(created.ok()).toBeTruthy();

  await page.goto('/profiles');
  await expect(page.getByText('Active profile')).toBeVisible();

  await test.step('pausing flips the state and survives a reload', async () => {
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText('Paused profile')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Paused profile')).toBeVisible();
  });

  await test.step('editing a paused profile does not silently reactivate it', async () => {
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await page.locator('input[name="name"]').fill('Backend Leadership (updated)');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Paused profile')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Backend Leadership (updated)' })).toBeVisible();
  });

  await test.step('reactivating flips it back', async () => {
    await page.getByRole('button', { name: 'Reactivate' }).click();
    await expect(page.getByText('Active profile')).toBeVisible();
  });
});
