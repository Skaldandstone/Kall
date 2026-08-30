import { test, expect, type Page } from '@playwright/test';

const initialProfile = {
  id: 7, name: 'Quality Leadership', target_titles: ['QA Director'], industries: ['SaaS'],
  functional_areas: ['Quality Engineering'], include_keywords: ['automation'], exclude_keywords: ['unpaid'],
  countries: ['United States'], states_regions: ['Washington'], work_types: ['remote'], employment_types: ['full_time'],
  minimum_base: 0, target_base: 180000, stretch_base: 200000, minimum_total_comp: null, target_total_comp: null,
  target_bonus_percent: 0, travel_max_percent: 0, relocation_preference: 'none', equity_preference: 'nice_to_have',
  default_resume_id: null, default_resume_name: null, is_active: true, match_count: 2, best_match_score: 80,
  completeness: { score: 100 },
};

async function syntheticProfileApi(page: Page) {
  const state = { profile: structuredClone(initialProfile), created: null as Record<string, unknown> | null, failSave: false };
  await page.route('**/api/kall/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/kall/', '');
    const method = route.request().method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === 'me') return json({ full_name: 'Alex Morgan', email: 'alex@example.test' });
    if (path === 'me/career-profiles/functional-areas') return json({ areas: [
      { name: 'Quality Engineering', related_roles: ['SDET', 'test automation'] },
      { name: 'Product Management', related_roles: ['product manager'] },
    ] });
    if (path === 'me/career-profiles/7' && method === 'PUT') {
      if (state.failSave) return json({ detail: 'Synthetic save failure' }, 503);
      Object.assign(state.profile, route.request().postDataJSON());
      return json(state.profile);
    }
    if (path === 'me/career-profiles') return json({ profiles: [state.profile] });
    if (path === 'me/resume-studio') return json({ resumes: [] });
    if (path === 'me/professional-profiles' && method === 'POST') {
      state.created = route.request().postDataJSON();
      return json({ id: 8, ...state.created });
    }
    return route.continue();
  });
  return state;
}

test('targeting and zero values survive edits, pauses, reloads and save failures', async ({ page }, info) => {
  const state = await syntheticProfileApi(page);
  await page.goto('/profiles');
  await page.getByRole('button', { name: 'Edit profile' }).click();
  await expect(page.locator('[name="functional_areas"]')).toHaveValue('Quality Engineering');
  await expect(page.locator('[name="exclude_keywords"]')).toHaveValue('unpaid');
  await expect(page.locator('[name="travel_max_percent"]')).toHaveValue('0');
  await page.locator('[name="functional_areas"]').fill('Quality Engineering, Technical Writing');
  await page.locator('[name="exclude_keywords"]').fill('unpaid, door-to-door');
  await page.locator('[name="target_bonus_percent"]').fill('0');
  await page.locator('[name="minimum_base"]').fill('0');
  await page.screenshot({ path: info.outputPath(`functional-area-editor-${info.project.name}.png`), fullPage: true });

  state.failSave = true;
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Unable to update profile.')).toBeVisible();
  await expect(page.locator('[name="functional_areas"]')).toHaveValue('Quality Engineering, Technical Writing');
  state.failSave = false;
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('heading', { name: 'Quality Leadership' })).toBeVisible();
  expect(state.profile.functional_areas).toEqual(['Quality Engineering', 'Technical Writing']);
  expect(state.profile.exclude_keywords).toEqual(['unpaid', 'door-to-door']);
  expect(state.profile.minimum_base).toBe(0);
  expect(state.profile.travel_max_percent).toBe(0);
  expect(state.profile.target_bonus_percent).toBe(0);

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Paused profile')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Paused profile')).toBeVisible();
  await page.getByRole('button', { name: 'Reactivate' }).click();
  await expect(page.getByText('Active profile')).toBeVisible();
  expect(state.profile.functional_areas).toEqual(['Quality Engineering', 'Technical Writing']);
  expect(state.profile.exclude_keywords).toEqual(['unpaid', 'door-to-door']);
  expect(state.profile.travel_max_percent).toBe(0);
  await page.screenshot({ path: info.outputPath(`functional-area-profile-${info.project.name}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('onboarding submits custom areas, exclusions and zero compensation', async ({ page }, info) => {
  const state = await syntheticProfileApi(page);
  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.locator('[name="name"]').fill('Quality Leadership');
  await page.locator('[name="target_titles"]').fill('QA Director');
  await page.locator('[name="functional_areas"]').fill('Quality Engineering, Technical Writing');
  await page.locator('[name="exclude_keywords"]').fill('unpaid');
  await page.locator('[name="minimum_base"]').fill('0');
  await page.locator('[name="target_base"]').fill('0');
  await page.screenshot({ path: info.outputPath(`functional-area-onboarding-${info.project.name}.png`), fullPage: true });
  await page.getByRole('button', { name: 'Save strategy' }).click();
  await expect(page.getByRole('heading', { name: 'Your first career workspace is prepared.' })).toBeVisible();
  expect(state.created?.functional_areas).toEqual(['Quality Engineering', 'Technical Writing']);
  expect(state.created?.exclude_keywords).toEqual(['unpaid']);
  expect(state.created?.minimum_base).toBe(0);
  expect(state.created?.target_base).toBe(0);
});
