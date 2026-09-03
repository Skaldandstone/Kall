import { test, expect } from '@playwright/test';
import { buildQuery, parseQuery } from '../app/lib/searchQuery';

test.beforeEach(async ({ page }) => {
  // Never call Clerk, Google or another external service from fixture tests.
  await page.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

test('query rebuild preserves exclusions, quoted phrases and single sites', () => {
  const query = '(site:jobs.lever.co OR site:boards.greenhouse.io) ("QA Director" OR "Quality Engineering") ("Software") -"intern" -"sales manager"';
  const rebuilt = buildQuery(parseQuery(query));
  expect(rebuilt).toContain('-"intern"');
  expect(rebuilt).toContain('-"sales manager"');
  expect(rebuilt).toContain('("QA Director" OR "Quality Engineering")');
  expect(buildQuery(parseQuery('site:jobs.lever.co "Quality Engineering" -intern'))).toBe('site:jobs.lever.co "Quality Engineering" -"intern"');
});

test('an intitle: title group displays as a clean term but rebuilds with the operator intact', () => {
  // build_search_intent restricts the title clause to intitle: so results are
  // real postings, not a company's aggregate jobs-index page (see #188) --
  // that operator must never appear in a term a person sees on screen.
  const query = '(intitle:"QA Director" OR intitle:"Quality Engineering") "Software"';
  const groups = parseQuery(query);
  const titles = groups.find((group) => group.label === 'Job titles');
  expect(titles?.terms).toEqual(['QA Director', 'Quality Engineering']);
  expect(buildQuery(groups)).toBe(query);
});

test('all navigation destinations fit and both entry paths remain available', async ({ page }) => {
  await page.goto('/dashboard');
  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  for (const name of ['Brief', 'Opportunities', 'Applications', 'Documents', 'Career']) {
    const link = nav.getByRole('link', { name, exact: true });
    await expect(link).toBeVisible();
    const bounds = await link.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByRole('link', { name: /Search open roles/ })).toHaveAttribute('href', '/search');
  await expect(page.getByRole('link', { name: /Set a career direction/ })).toHaveAttribute('href', '/profiles');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('Inscription shell preserves keyboard access and a readable responsive hierarchy', async ({ page }) => {
  await page.goto('/morning-brief');
  await expect(page.locator('html')).toHaveAttribute('data-kall-theme', 'inscription');
  await expect(page.getByRole('region', { name: 'Career record, resumes, and career plan' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Update the facts Kall can use/ })).toHaveAttribute('href', '/profiles');
  await expect(page.getByRole('link', { name: /Choose the right source for each role/ })).toHaveAttribute('href', '/resumes');
  await expect(page.getByRole('link', { name: /Turn a target role into specific steps/ })).toHaveAttribute('href', '/profiles?tab=growth');

  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to page content' });
  await expect(skip).toBeFocused();
  await skip.press('Enter');
  await expect(page.locator('#workspace-content')).toBeFocused();

  const metrics = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    displayFont: getComputedStyle(document.querySelector('h1')!).fontFamily,
    bodyContrast: getComputedStyle(document.body).color,
  }));
  expect(metrics.overflow).toBe(false);
  expect(metrics.displayFont).toContain('Cormorant');
  expect(metrics.bodyContrast).not.toBe('rgba(0, 0, 0, 0)');
});

test('optional profile does not silently replace a saved search', async ({ page }) => {
  const query = '("Quality Engineering" OR "QA Director") -"intern"';
  await page.goto(`/search?q=${encodeURIComponent(query)}`);
  await expect(page.getByLabel('Professional profile (optional)')).toHaveValue('');
  await expect(page.getByText('Excluded terms')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('q')).toBe(query);
  await page.getByRole('button', { name: 'Search jobs', exact: true }).click();
  expect(new URL(page.url()).searchParams.get('q')).toContain('-"intern"');
});

test('a profile search with results populates every site at once, not one page at a time', async ({ page }) => {
  await page.goto('/search');
  await page.getByLabel('Professional profile (optional)').selectOption('1');
  await page.getByRole('button', { name: 'Search jobs', exact: true }).click();
  await expect(page.getByText('2 results across 2 sites')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Director of Quality Engineering' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'QA Director' })).toBeVisible();
  // No per-site pager -- results from every site already appear together.
  await expect(page.getByRole('button', { name: 'Next site' })).toHaveCount(0);
});

test('a search falls back to the per-site widget when aggregation is unavailable', async ({ page }) => {
  await page.route('**/api/kall/discovery/search-results/*', (route) => route.fulfill({ json: { enabled: false, results: [], sites_searched: 0, sites_failed: 0 } }));
  await page.goto('/search');
  await page.getByLabel('Professional profile (optional)').selectOption('1');
  await page.getByRole('button', { name: 'Search jobs', exact: true }).click();
  await expect(page.getByText(/Queued \d+ site searches/)).toBeVisible();
});

test('profile search failure keeps entered terms and provides inline feedback', async ({ page }) => {
  await page.route('**/api/kall/discovery/ats-search/*', (route) => route.fulfill({ status: 503, json: { detail: 'Profile search is temporarily unavailable.' } }));
  await page.goto('/search');
  await page.getByLabel('Professional profile (optional)').selectOption('1');
  await page.getByLabel('Job title or search terms').fill('Release quality');
  await page.getByRole('button', { name: 'Search jobs', exact: true }).click();
  await expect(page.getByLabel('Job title or search terms')).toHaveValue('Release quality');
  await expect(page.locator('.search-page-controls-column .notice')).toHaveText('Profile search is temporarily unavailable.');
});

test('preparation keeps a manual resume selection without refetching options', async ({ page }) => {
  let profileRequests = 0;
  page.on('request', (request) => { if (request.url().endsWith('/me/professional-profiles')) profileRequests += 1; });
  await page.goto('/applications/new?job=17&profile=1');
  await expect(page.getByLabel('Resume', { exact: true })).toHaveValue('1');
  await page.getByLabel('Professional profile', { exact: true }).selectOption('2');
  await expect(page.getByLabel('Resume', { exact: true })).toHaveValue('2');
  await page.getByLabel('Resume', { exact: true }).selectOption('1');
  await page.getByRole('checkbox', { name: 'Generate a role-specific cover letter draft' }).uncheck();
  await page.getByRole('button', { name: 'Prepare application', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Continue to application review' })).toBeVisible();
  await expect(page.getByLabel('Resume', { exact: true })).toHaveValue('1');
  expect(profileRequests).toBe(1);
  await page.getByLabel('Resume', { exact: true }).selectOption('2');
  await expect(page.getByRole('link', { name: 'Continue to application review' })).toHaveCount(0);
});

test('preparation options failure can be retried without becoming an empty profile list', async ({ page }) => {
  let failing = true;
  await page.route('**/api/kall/me/resumes', (route) => failing ? route.fulfill({ status: 503, json: { detail: 'Unavailable' } }) : route.continue());
  await page.goto('/applications/new?job=17&profile=1');
  await expect(page.getByRole('button', { name: 'Retry loading options' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare application', exact: true })).toBeDisabled();
  failing = false;
  await page.getByRole('button', { name: 'Retry loading options' }).click();
  await expect(page.getByRole('button', { name: 'Prepare application', exact: true })).toBeEnabled();
});

test('missing preparation prerequisites have actionable recovery links', async ({ page }) => {
  await page.route('**/api/kall/me/professional-profiles', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/kall/me/resumes', (route) => route.fulfill({ json: [] }));
  await page.goto('/applications/new');
  await expect(page.getByRole('link', { name: 'Create a profile', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Upload a resume', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Find an opportunity', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare application', exact: true })).toBeDisabled();
});

test('review never claims readiness while loading or after a failed load', async ({ page }) => {
  let failReview = true;
  await page.route('**/api/kall/applications/41/review', async (route) => {
    if (route.request().method() === 'GET' && failReview) await route.fulfill({ status: 503, json: { detail: 'Review is temporarily unavailable.' } });
    else await route.continue();
  });
  await page.goto('/applications/41');
  await expect(page.getByRole('button', { name: 'Retry review' })).toBeVisible();
  await expect(page.getByText('All required review items are complete.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Approve application package' })).toBeDisabled();
  failReview = false;
  await page.getByRole('button', { name: 'Retry review' }).click();
  await expect(page.getByLabel('Describe your quality leadership experience.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm review items' })).toBeEnabled();
});

test('Brief failure is recoverable without blocking search and career', async ({ page }) => {
  let failed = true;
  await page.route('**/api/kall/me/morning-brief', (route) => failed ? route.fulfill({ status: 503, json: { detail: 'Brief is temporarily unavailable.' } }) : route.continue());
  await page.goto('/morning-brief');
  await expect(page.locator('main [role="alert"]')).toContainText('Brief is temporarily unavailable.');
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await expect(page.locator('main [role="alert"]')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Search for a job' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open career profile' })).toBeVisible();
  failed = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Good morning, Jordan.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open tracked opportunities' })).toHaveAttribute('href', '/search?tab=discovery');
  await expect(page.getByRole('link', { name: 'Save for later' })).toHaveCount(0);
});

test('preparation locks choices during a request and keeps them after failure', async ({ page }) => {
  let finish: () => void = () => {};
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  await page.route('**/api/kall/applications/prepare-options', async (route) => {
    await pending;
    await route.fulfill({ status: 503, json: { detail: 'Draft preparation is unavailable.' } });
  });
  await page.goto('/applications/new?job=17&profile=1');
  await page.getByRole('checkbox', { name: 'Generate a role-specific cover letter draft' }).uncheck();
  await page.getByRole('button', { name: 'Prepare application', exact: true }).click();
  await expect(page.getByLabel('Resume', { exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Generate a role-specific cover letter draft' })).toBeDisabled();
  finish();
  await expect(page.getByRole('button', { name: 'Prepare application', exact: true })).toBeEnabled();
  await expect(page.getByRole('checkbox', { name: 'Generate a role-specific cover letter draft' })).not.toBeChecked();
  await expect(page.getByLabel('Resume', { exact: true })).toHaveValue('1');
  await expect(page.getByRole('link', { name: 'Continue to application review' })).toHaveCount(0);
});

test('review edits survive a failed save and never trigger approval', async ({ page }) => {
  let approvals = 0;
  page.on('request', (request) => { if (request.url().endsWith('/review/approve')) approvals += 1; });
  await page.route('**/api/kall/applications/41/answers/9', (route) => route.abort('failed'));
  await page.goto('/applications/41');
  const answer = page.getByLabel('Describe your quality leadership experience.');
  await answer.fill('My edited leadership evidence.');
  await page.getByRole('button', { name: 'Save edit', exact: true }).click();
  await expect(page.getByText('Kall could not save that action. Your entries are still here. Please try again.')).toBeVisible();
  await expect(answer).toHaveValue('My edited leadership evidence.');
  expect(approvals).toBe(0);
});

test('search can be completed with the keyboard', async ({ page }) => {
  await page.goto('/search');
  const profile = page.getByLabel('Professional profile (optional)');
  await expect(profile).toBeEnabled();
  await profile.focus();
  await page.keyboard.press('Tab');
  const terms = page.getByLabel('Job title or search terms');
  await expect(terms).toBeFocused();
  await terms.fill('Quality leadership');
  await terms.press('Enter');
  await expect(page.getByRole('button', { name: /Remove Quality leadership/ })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('q')).toBe('"Quality leadership"');
});

test('current flows fit the viewport without horizontal scrolling', async ({ page }) => {
  for (const path of ['/morning-brief', '/search', '/applications/new?job=17&profile=1', '/applications/41']) {
    await page.goto(path);
    await expect(page.locator('main h1')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
  }
});
