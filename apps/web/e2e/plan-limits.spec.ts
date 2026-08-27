import { test, expect, signInAsNewUser } from './helpers';

/**
 * The caps only matter if the person hitting one is told something useful.
 * These drive the real limit rather than stubbing it.
 */
test('the paywall appears when a free account runs out, and says when it refills', async ({ page }) => {
  await signInAsNewUser(page, 'Quota Test');

  // Spend the free weekly AI allowance through the API, then trigger one more
  // from the UI so the dialog is raised by a real refusal.
  const usage = await (await page.request.get('/api/kall/me/usage')).json();
  expect(usage.meters.applications.limit).toBe(5);
  expect(usage.meters.applications.period).toBe('week');

  await page.goto('/billing');
  await expect(page.getByRole('heading', { name: /Five a week, free/ })).toBeVisible();

  await test.step('usage is visible before any limit bites', async () => {
    await expect(page.getByText('0 of 5')).toBeVisible();
    await expect(page.getByText(/Refills/).first()).toBeVisible();
  });

  await test.step('all three plans are offered at the agreed prices', async () => {
    await expect(page.getByText('$5')).toBeVisible();
    await expect(page.getByText('$15')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose Plus' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose Premium' })).toBeVisible();
  });

  await test.step('choosing a plan says payments are off rather than failing silently', async () => {
    await page.getByRole('button', { name: 'Choose Plus' }).click();
    await expect(page.getByText(/not switched on yet/)).toBeVisible();
  });
});

test('exhausting the weekly allowance raises the paywall from a real refusal', async ({ page }) => {
  await signInAsNewUser(page, 'Exhaust Test');
  const profile = await (await page.request.post('/api/kall/me/professional-profiles', {
    data: { name: 'Backend', target_titles: ['Backend Engineer'] },
  })).json();

  // An allowance is spent when an application reaches SUBMITTED, not when it
  // is prepared -- preparing only checks, so abandoning one costs nothing.
  for (let i = 0; i < 5; i += 1) {
    const tracked = await page.request.post('/api/kall/applications/track-external', {
      data: {
        url: `https://boards.example.com/jobs/${i}`,
        title: `Role ${i}`,
        snippet: 'x',
        source: 'google_cse',
        professional_profile_id: profile.id,
      },
    });
    expect(tracked.ok(), `application ${i + 1} should be allowed`).toBeTruthy();
  }

  const after = await (await page.request.get('/api/kall/me/usage')).json();
  expect(after.meters.applications.used).toBe(5);
  expect(after.meters.applications.remaining).toBe(0);

  // The sixth is refused by the server.
  const sixth = await page.request.post('/api/kall/applications/track-external', {
    data: {
      url: 'https://boards.example.com/jobs/6', title: 'Role 6', snippet: 'x',
      source: 'google_cse', professional_profile_id: profile.id,
    },
  });
  expect(sixth.status()).toBe(402);
  const refusal = await sixth.json();
  expect(refusal.detail.code).toBe('plan_limit_reached');
  expect(refusal.detail.period).toBe('week');

  // And the same refusal, reached through the UI, raises the paywall.
  const seventh = await (await page.request.post('/api/kall/jobs/import-search-result', {
    data: { url: 'https://boards.example.com/jobs/7', title: 'Role 7', snippet: 'x', source: 'google_cse' },
  })).json();
  await page.goto(`/applications/new?job=${seventh.id}&profile=${profile.id}`);
  await page.getByRole('button', { name: 'Prepare application' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Leads with when it comes back, not with the price.
  await expect(dialog.getByText(/refills on/i)).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /this week/i })).toBeVisible();
  await expect(dialog.getByRole('link', { name: /Choose Plus/ })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
