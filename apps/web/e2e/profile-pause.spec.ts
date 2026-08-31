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
    data: {
      name: 'Backend Leadership', target_titles: ['Senior Backend Engineer'],
      functional_areas: ['Software Engineering'], exclude_keywords: ['unpaid internship'],
      minimum_base: 0,
    },
  });
  expect(created.ok()).toBeTruthy();
  const profileId = (await created.json()).id;

  async function storedProfile() {
    const response = await page.request.get('/api/kall/me/career-profiles');
    expect(response.ok()).toBeTruthy();
    return (await response.json()).profiles.find((profile: { id: number }) => profile.id === profileId);
  }

  await page.goto('/profiles');
  await expect(page.getByText('Active profile')).toBeVisible();

  await test.step('pausing flips the state and survives a reload', async () => {
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText('Paused profile')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Paused profile')).toBeVisible();
    const saved = await storedProfile();
    expect(saved.functional_areas).toEqual(['Software Engineering']);
    expect(saved.exclude_keywords).toEqual(['unpaid internship']);
    expect(saved.minimum_base).toBe(0);
  });

  await test.step('editing a paused profile does not silently reactivate it', async () => {
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await page.locator('input[name="name"]').fill('Backend Leadership (updated)');
    await expect(page.locator('input[name="functional_areas"]')).toHaveValue('Software Engineering');
    await expect(page.locator('input[name="exclude_keywords"]')).toHaveValue('unpaid internship');
    await page.locator('input[name="functional_areas"]').fill('Quality Engineering, Technical Writing');
    await page.locator('input[name="exclude_keywords"]').fill('unpaid internship, door-to-door');
    await page.locator('input[name="travel_max_percent"]').fill('0');
    await page.locator('input[name="target_bonus_percent"]').fill('0');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Paused profile')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Backend Leadership (updated)' })).toBeVisible();
    const saved = await storedProfile();
    expect(saved.functional_areas).toEqual(['Quality Engineering', 'Technical Writing']);
    expect(saved.exclude_keywords).toEqual(['unpaid internship', 'door-to-door']);
    expect(saved.minimum_base).toBe(0);
    expect(saved.travel_max_percent).toBe(0);
    expect(saved.target_bonus_percent).toBe(0);
  });

  await test.step('reactivating flips it back', async () => {
    await page.getByRole('button', { name: 'Reactivate' }).click();
    await expect(page.getByText('Active profile')).toBeVisible();
    await page.reload();
    const saved = await storedProfile();
    expect(saved.functional_areas).toEqual(['Quality Engineering', 'Technical Writing']);
    expect(saved.exclude_keywords).toEqual(['unpaid internship', 'door-to-door']);
    expect(saved.travel_max_percent).toBe(0);
    expect(saved.target_bonus_percent).toBe(0);
  });
});

test('onboarding stores functional areas and exclusions without discarding zero salary', async ({ page }) => {
  await signInAsNewUser(page, 'Functional Areas Test');
  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.locator('input[name="name"]').fill('Quality Leadership');
  await page.locator('[name="target_titles"]').fill('QA Director');
  await page.locator('input[name="functional_areas"]').fill('Quality Engineering');
  await page.locator('input[name="exclude_keywords"]').fill('unpaid');
  await page.locator('input[name="minimum_base"]').fill('0');
  await page.getByRole('button', { name: 'Save strategy' }).click();
  await expect(page.getByRole('heading', { name: 'Your first career workspace is prepared.' })).toBeVisible();
  const response = await page.request.get('/api/kall/me/career-profiles');
  const profile = (await response.json()).profiles.find((row: { name: string }) => row.name === 'Quality Leadership');
  expect(profile.functional_areas).toEqual(['Quality Engineering']);
  expect(profile.exclude_keywords).toEqual(['unpaid']);
  expect(profile.minimum_base).toBe(0);
});
