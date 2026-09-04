import { test, expect, signInAsNewUser, completeOnboarding, completeDocumentsReview, seedJob, firstProfileId } from './helpers';

/**
 * Continues past where canonical-journey.spec.ts stops (application
 * approved) through the rest of the submission pipeline: preparing an
 * immutable preview and confirming it. Per services/submissions.py's own
 * comment, "Provider transport remains an adapter boundary" -- prepare/
 * confirm never call a live Greenhouse/Lever/Ashby endpoint, so this whole
 * chain is CI-safe.
 *
 * A job seeded through POST /jobs/import-search-result (a generic search
 * result, not a configured ATS board) has no supported connector, and this
 * account's review has open screening questions -- so confirm_submission
 * correctly lands on "needs_manual_completion" with an "Open manual
 * application" fallback link, not "confirmed". That's the realistic
 * outcome for most real jobs (most aren't posted through one of Kall's
 * three configured ATS providers), so this test asserts that outcome
 * rather than forcing an artificial fully-automated path.
 */
test('an approved application from an unsupported connector lands on manual completion', async ({ page }) => {
  const unique = Date.now();
  await signInAsNewUser(page);
  await completeOnboarding(page);

  const profileId = await firstProfileId(page);
  const job = await seedJob(page);

  let applicationId = '';
  await test.step('prepare and approve the application', async () => {
    await page.goto(`/applications/new?job=${job.id}&profile=${profileId}`);
    await page.getByRole('button', { name: 'Prepare application' }).click();
    // Preparing now navigates straight into the tailoring review instead of
    // stopping at a summary card with a link to click through.
    await expect(page).toHaveURL(/\/applications\/\d+$/, { timeout: 15_000 });
    applicationId = page.url().split('/').pop()!;

    await completeDocumentsReview(page);
    const confirmReview = page.getByRole('button', { name: 'Confirm review items' });
    await expect(confirmReview).toBeEnabled({ timeout: 15_000 });
    await confirmReview.click();
    await expect(page.getByText('All required review items are complete.')).toBeVisible();
    await page.getByRole('button', { name: 'Approve application package' }).click();
    await expect(page.getByText('Stage: approved')).toBeVisible({ timeout: 15_000 });
  });

  await test.step('prepare an immutable submission preview', async () => {
    await page.getByRole('button', { name: 'Prepare immutable preview' }).click();
    await expect(page.getByText('Immutable preview prepared. Review every field before confirming.')).toBeVisible({ timeout: 15_000 });
  });

  await test.step('confirming the preview reports why it needs manual completion', async () => {
    await page.getByRole('button', { name: 'Confirm exact preview' }).click();
    await expect(page.getByRole('heading', { name: 'needs_manual_completion' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Connector is unsupported/).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open manual application' })).toHaveAttribute('href', job.url);
    // A connector this unsupported never becomes submittable automatically.
    await expect(page.getByRole('button', { name: 'Create submission attempt' })).toBeDisabled();
  });
});
