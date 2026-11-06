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

test('changing profiles discards an in-flight search response from the old profile', async ({ page }) => {
  await signInAsNewUser(page, 'Search Recovery Test');

  const createProfile = async (name: string, title: string) => {
    const response = await page.request.post('/api/kall/me/professional-profiles', {
      data: { name, target_titles: [title] },
    });
    expect(response.ok()).toBeTruthy();
    return response.json() as Promise<{ id: number }>;
  };
  const first = await createProfile('First Direction', 'Platform Engineering Director');
  const second = await createProfile('Second Direction', 'Product Operations Director');

  await page.route(`**/api/kall/discovery/ats-search/${first.id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        intent: '"Platform Engineering Director"',
        queries: [{ provider: 'Example', domain: 'jobs.example.test' }],
      }),
    });
  });

  let releaseSearch: (() => void) | undefined;
  let markSearchStarted: (() => void) | undefined;
  const heldSearch = new Promise<void>((resolve) => { releaseSearch = resolve; });
  const searchStarted = new Promise<void>((resolve) => { markSearchStarted = resolve; });
  await page.route(`**/api/kall/discovery/search-results/${first.id}`, async (route) => {
    markSearchStarted?.();
    await heldSearch;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        enabled: true,
        sites_searched: 1,
        sites_failed: 0,
        results: [{
          title: 'Stale Platform Role',
          url: 'https://jobs.example.test/stale-platform-role',
          snippet: 'This belongs only to the first profile.',
          provider: 'Example',
          domain: 'jobs.example.test',
        }],
      }),
    });
  });

  await page.goto('/search');
  const profileSelect = page.getByLabel('Professional profile (optional)');
  await profileSelect.selectOption(String(first.id));
  await page.getByRole('button', { name: 'Search jobs' }).click();
  await searchStarted;
  await expect(page.getByRole('heading', { name: 'Looking across matching job sources' })).toBeVisible();

  await profileSelect.selectOption(String(second.id));
  const obsoleteResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/kall/discovery/search-results/${first.id}`) &&
    response.request().method() === 'POST',
  );
  releaseSearch?.();
  await obsoleteResponse;

  await expect(page.getByRole('button', { name: 'Search jobs' })).toBeEnabled();
  await expect(page.getByText('Stale Platform Role')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'No search has run yet' })).toBeVisible();
});

test('typing new terms while a search starts does not erase the newer draft', async ({ page }) => {
  await signInAsNewUser(page, 'Search Draft Recovery Test');

  const profileResponse = await page.request.post('/api/kall/me/professional-profiles', {
    data: { name: 'Draft Direction', target_titles: ['Design Director'] },
  });
  expect(profileResponse.ok()).toBeTruthy();
  const profile = await profileResponse.json() as { id: number };

  let releasePlan: (() => void) | undefined;
  let markPlanStarted: (() => void) | undefined;
  const heldPlan = new Promise<void>((resolve) => { releasePlan = resolve; });
  const planStarted = new Promise<void>((resolve) => { markPlanStarted = resolve; });
  await page.route(`**/api/kall/discovery/ats-search/${profile.id}`, async (route) => {
    markPlanStarted?.();
    await heldPlan;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        intent: '"Design Director"',
        queries: [{ provider: 'Example', domain: 'jobs.example.test' }],
      }),
    });
  });
  await page.route(`**/api/kall/discovery/search-results/${profile.id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ enabled: true, sites_searched: 1, sites_failed: 0, results: [] }),
    });
  });

  await page.goto('/search');
  await page.getByLabel('Professional profile (optional)').selectOption(String(profile.id));
  const terms = page.getByLabel('Job title or search terms');
  await terms.fill('portfolio strategy');
  await page.getByRole('button', { name: 'Search jobs' }).click();
  await planStarted;
  await terms.fill('creative operations');
  releasePlan?.();

  await expect(page.getByText('Search complete.')).toBeVisible();
  await expect(terms).toHaveValue('creative operations');
});

test('removing a term releases loading while the superseded search settles', async ({ page }) => {
  await signInAsNewUser(page, 'Search Term Recovery Test');

  const profileResponse = await page.request.post('/api/kall/me/professional-profiles', {
    data: { name: 'Term Direction', target_titles: ['Engineering Director'] },
  });
  expect(profileResponse.ok()).toBeTruthy();
  const profile = await profileResponse.json() as { id: number };

  await page.route(`**/api/kall/discovery/ats-search/${profile.id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        intent: '(Engineering Director OR Remote)',
        queries: [{ provider: 'Example', domain: 'jobs.example.test' }],
      }),
    });
  });

  let releaseSearch: (() => void) | undefined;
  let markSearchStarted: (() => void) | undefined;
  const heldSearch = new Promise<void>((resolve) => { releaseSearch = resolve; });
  const searchStarted = new Promise<void>((resolve) => { markSearchStarted = resolve; });
  await page.route(`**/api/kall/discovery/search-results/${profile.id}`, async (route) => {
    markSearchStarted?.();
    await heldSearch;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        enabled: true,
        sites_searched: 1,
        sites_failed: 0,
        results: [{
          title: 'Obsolete Engineering Role',
          url: 'https://jobs.example.test/obsolete-engineering-role',
          snippet: 'This response was superseded by the term edit.',
          provider: 'Example',
          domain: 'jobs.example.test',
        }],
      }),
    });
  });

  await page.goto('/search');
  await page.getByLabel('Professional profile (optional)').selectOption(String(profile.id));
  await page.getByRole('button', { name: 'Search jobs' }).click();
  await searchStarted;
  await expect(page.getByRole('heading', { name: 'Looking across matching job sources' })).toBeVisible();

  const obsoleteResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/kall/discovery/search-results/${profile.id}`) &&
    response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /Remove Remote/ }).click();
  await expect(page.getByRole('button', { name: 'Search jobs' })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Looking across matching job sources' })).toHaveCount(0);

  releaseSearch?.();
  await obsoleteResponse;
  await expect(page.getByRole('button', { name: 'Search jobs' })).toBeEnabled();
  await expect(page.getByText('Obsolete Engineering Role')).toHaveCount(0);
});
