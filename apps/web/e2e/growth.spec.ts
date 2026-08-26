import { test, expect, signInAsNewUser } from './helpers';

/**
 * Coverage for the Growth section (career goal -> AI-or-deterministic plan
 * -> milestones -> skills analysis -> saved resources) rebuilt this session,
 * and reused as-is by the mobile app's Growth screen. No OpenAI key is
 * configured in the e2e environment, so this exercises the deterministic
 * fallback path (backend/kall/api_growth.py's `_deterministic_plan_content`)
 * -- the path every CI run and most local dev actually takes.
 */
test('creating a career goal produces a plan, and resources can be saved and pinned', async ({ page }) => {

  await signInAsNewUser(page, 'Growth Section Test');

  await page.goto('/profiles?tab=growth');

  await test.step('create a goal and generate its plan', async () => {
    await page.locator('input[name="title"]').fill('Move into engineering leadership');
    await page.locator('input[name="target_role"]').fill('Engineering Manager');
    await page.locator('input[name="target_industry"]').fill('Software');
    await page.getByRole('button', { name: 'Create goal and plan' }).click();

    await expect(page.getByRole('heading', { name: 'Move into engineering leadership' })).toBeVisible();
    await expect(page.getByText(/A practical path toward Engineering Manager in Software/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Map the role' })).toBeVisible();
  });

  await test.step('regenerate the plan', async () => {
    await page.getByRole('button', { name: 'Regenerate plan' }).click();
    await expect(page.getByText('Growth plan regenerated.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Map the role' })).toBeVisible();
  });

  await test.step('analyze skills with the deterministic fallback', async () => {
    await page.getByPlaceholder(/three years of experience/).fill('Five years leading a small backend team, mentoring two engineers.');
    await page.getByRole('button', { name: 'AI Analyze' }).click();
    await expect(page.getByText('40%')).toBeVisible();
    await expect(page.getByText(/general starting estimate/)).toBeVisible();
  });

  const planId: number = await test.step('read back the plan id for direct resource seeding', async () => {
    const dashboard = await (await page.request.get('/api/kall/growth')).json();
    return dashboard.goals[0].plan.plan.id;
  });
  expect(planId).toBeGreaterThan(0);

  await test.step('save a resource directly (the web UI only offers this via the Google widget) and pin it from the UI', async () => {
    const resource = await (
      await page.request.post(`/api/kall/growth/plans/${planId}/resources`, {
        data: { url: 'https://example.com/engineering-management-course', title: 'Engineering Management 101' },
      })
    ).json();
    expect(resource.id).toBeGreaterThan(0);
    expect(resource.saved).toBe(false);

    await page.reload();
    await expect(page.getByText('Engineering Management 101')).toBeVisible();
    await page.getByRole('button', { name: 'Pin' }).click();
    await expect(page.getByRole('button', { name: 'Pinned' })).toBeVisible();
  });
});
