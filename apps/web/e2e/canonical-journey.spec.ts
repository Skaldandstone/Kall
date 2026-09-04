import path from 'node:path';
import { test, expect, signInAsNewUser, completeOnboarding, completeDocumentsReview, firstProfileId } from './helpers';

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
test('sign-up through application review and approval', async ({ page }) => {
  const unique = Date.now();
  await signInAsNewUser(page, 'Jordan Smoke Test');
  await page.goto('/onboarding');

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

  const profileId = await firstProfileId(page);
  expect(profileId).toBeGreaterThan(0);

  const job = await test.step('seed an opportunity to apply to', async () => {
    const response = await page.request.post(`/api/kall/jobs/import-search-result`, {
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
    // Preparing now navigates straight into the tailoring review instead of
    // stopping at a summary card with a link to click through.
    await expect(page).toHaveURL(/\/applications\/\d+$/, { timeout: 15_000 });
    applicationId = page.url().split('/').pop()!;
    expect(Number(applicationId)).toBeGreaterThan(0);
  });

  await test.step('review and approve the application', async () => {
    await expect(page.getByText('Stage: review')).toBeVisible();
    await completeDocumentsReview(page);
    const confirmReview = page.getByRole('button', { name: 'Confirm review items' });
    await expect(confirmReview).toBeEnabled({ timeout: 15_000 });
    await confirmReview.click();
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
 * recognize a valid stored token and send them onward instead -- to
 * onboarding while it is still incomplete, to the dashboard once it is done.
 */
test('a signed-in user landing on the marketing homepage is sent onward, not shown the marketing page', async ({ page }) => {
  await signInAsNewUser(page, 'Home Redirect Test');

  // A brand-new account has never completed onboarding.
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding/);

  await completeOnboarding(page);

  await page.goto('/');
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText('What are you deciding today?')).toBeVisible();
});
