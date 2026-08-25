import { test, expect } from '@playwright/test';
import path from 'node:path';

/**
 * The one automated check that proves the whole product actually works end
 * to end, rather than each page working in isolation: register -> onboarding
 * (career strategy + resume) -> Morning Brief -> import an opportunity ->
 * prepare an application -> review and approve it.
 *
 * Job/opportunity seeding goes through POST /jobs/import-search-result
 * (the same endpoint the real "Apply with Kall" flow uses for an external
 * search result) instead of live Greenhouse/Lever/Ashby discovery, since
 * those require real provider credentials this test environment doesn't have.
 */
test('sign-up through application review and approval', async ({ page, request, baseURL }) => {
  const unique = Date.now();
  const email = `smoke-${unique}@example.com`;
  const password = 'CanonicalJourney123!';

  await test.step('register', async () => {
    await page.goto('/register');
    await page.locator('input[name="full_name"]').fill('Jordan Smoke Test');
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('input[name="password_confirmation"]').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/onboarding/);
  });

  const token = await page.evaluate(() => localStorage.getItem('kall_token'));
  expect(token).toBeTruthy();

  await test.step('dismiss the post-signup security setup modal', async () => {
    const securityDialog = page.getByRole('dialog', { name: 'Protect your Kall account' });
    await expect(securityDialog).toBeVisible();
    await securityDialog.getByRole('button', { name: 'Skip for now' }).click();
    await expect(securityDialog).not.toBeVisible();
  });

  await test.step('onboarding: resume upload', async () => {
    await page.setInputFiles('input[type="file"][name="file"]', path.join(__dirname, 'fixtures', 'sample-resume.txt'));
    await page.getByRole('button', { name: 'Upload resume' }).click();
    // Advancing to the strategy step is the signal the upload succeeded.
    await expect(page.getByRole('heading', { name: /where do you want your career to go/i })).toBeVisible();
  });

  await test.step('onboarding: career strategy', async () => {
    await page.locator('input[name="name"]').fill('Backend Leadership');
    await page.locator('textarea[name="target_titles"]').fill('Senior Backend Engineer, Staff Engineer');
    await page.locator('input[name="industries"]').fill('Software');
    await page.getByRole('button', { name: 'Save strategy' }).click();
    await expect(page.getByRole('heading', { name: /workspace is prepared/i })).toBeVisible();
    // Both checklist items must have flipped to done -- this is the real
    // assertion that the strategy and resume actually persisted server-side,
    // not just that the wizard's local step counter advanced.
    await expect(page.getByText('Your resume is in Resume Studio.')).toBeVisible();
    await expect(page.getByText('Your first direction is saved.')).toBeVisible();
  });

  await test.step('morning brief renders for the new account', async () => {
    await page.getByRole('link', { name: 'Open Morning Brief' }).click();
    await expect(page).toHaveURL(/\/morning-brief/);
    await expect(page.getByText('Preparing your brief…')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(/Sign in to view/)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Good morning|career, prepared quietly/i })).toBeVisible();
  });

  const profileId: number = await page.evaluate(async () => {
    const response = await fetch('/api/kall/me/professional-profiles', {
      headers: { Authorization: `Bearer ${localStorage.getItem('kall_token')}` },
    });
    const profiles = await response.json();
    return profiles[0].id;
  });
  expect(profileId).toBeGreaterThan(0);

  const job = await test.step('seed an opportunity to apply to', async () => {
    const response = await request.post(`${baseURL}/api/kall/jobs/import-search-result`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        url: `https://boards.example.com/jobs/${unique}`,
        title: 'Senior Backend Engineer',
        company: 'Acme Robotics',
        snippet: 'Own distributed systems powering our fulfillment network.',
        source: 'e2e-canonical-journey',
      },
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  });

  let applicationId = '';
  await test.step('prepare an application for the seeded opportunity', async () => {
    await page.goto(`/applications/new?job=${job.id}&profile=${profileId}`);
    await expect(page.locator('select').first()).toHaveValue(String(profileId));
    await page.getByRole('button', { name: 'Prepare application' }).click();
    await expect(page.getByRole('link', { name: 'Continue to application review' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Application prepared. Review and explicit approval are required before submission.')).toBeVisible();
    const href = await page.getByRole('link', { name: 'Continue to application review' }).getAttribute('href');
    applicationId = href!.split('/').pop()!;
    expect(Number(applicationId)).toBeGreaterThan(0);
  });

  await test.step('review and approve the application', async () => {
    await page.goto(`/applications/${applicationId}`);
    await expect(page.getByText('Stage: review')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm review items' }).click();
    await expect(page.getByText('All required review items are complete.')).toBeVisible();
    await page.getByRole('button', { name: 'Approve application package' }).click();
    await expect(page.getByText('Stage: approved')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Prepare immutable preview' })).toBeVisible();
  });
});

/**
 * Regression for a real "I keep getting logged out" report: a signed-in user
 * who lands back on the bare marketing homepage (closing and reopening the
 * browser to a bookmarked/typed root URL is the common way this happens) saw
 * the "Log in / Create account" marketing page with no sign they were still
 * signed in, since "/" never checked for an existing session. It should
 * recognize a valid stored token and send them straight to the dashboard.
 */
test('a signed-in user landing on the marketing homepage is sent to their dashboard', async ({ page }) => {
  const unique = Date.now();
  const email = `home-redirect-${unique}@example.com`;
  const password = 'CanonicalJourney123!';

  await page.goto('/register');
  await page.locator('input[name="full_name"]').fill('Home Redirect Test');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="password_confirmation"]').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/onboarding/);

  await page.goto('/');
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText('Make your next move clear.')).toBeVisible();
});
