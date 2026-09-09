import { test, expect, signInAsNewUser, completeOnboarding, seedJob, firstProfileId } from './helpers';

/**
 * Covers the chain that turns a job posting into finished application
 * documents: Job Intelligence (score a resume against a job) -> "Use this
 * resume" (creates the ResumeSelection that Tailoring depends on) ->
 * Tailoring (create + accept a proposal) -> Generate (resume package +
 * cover letter draft). All of this is deterministic, DB-backed scoring and
 * template logic -- no OpenAI/Stripe/live-network dependency anywhere in
 * this path (see backend/kall/services/match_intelligence.py,
 * services/tailoring.py, services/documents.py).
 */
test('job intelligence, tailoring, and document generation', async ({ page }) => {
  const unique = Date.now();
  await signInAsNewUser(page);
  await completeOnboarding(page);

  const profileId = await firstProfileId(page);
  const job = await seedJob(page);

  await test.step('build match intelligence and select a resume', async () => {
    await page.goto(`/job-intelligence?job=${job.id}&profile=${profileId}`);
    await expect(page.locator('input[name="job_id"]')).toHaveValue(String(job.id));
    // Supplying both IDs starts the analysis automatically. Clicking Compare
    // role here as well launches a second overlapping request and makes the
    // result depend on which response reaches the page last.
    await expect(page.getByText('Analysis complete.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Why each resume fits or falls short' })).toBeVisible();
    await page.getByRole('button', { name: 'Use this resume' }).first().click();
    await expect(page.getByText(/is now selected for this opportunity\./)).toBeVisible();
  });

  let proposalId = '';
  await test.step('create and accept a tailoring proposal', async () => {
    await page.goto('/resumes?tab=tailoring');
    // Resume Studio asks for the posting rather than exposing an internal job
    // ID. Reusing the seeded URL resolves to the same stored job and therefore
    // preserves the resume selection made in the previous step.
    await page.getByRole('textbox', { name: 'Job posting link' }).fill(String(job.url));
    await page.getByRole('textbox', { name: 'Job title' }).fill(String(job.title));
    await page.getByRole('textbox', { name: 'Job description' }).fill(String(job.description || job.snippet));
    await expect(page.getByRole('button', { name: 'Create proposal' })).toBeEnabled();
    await page.getByRole('button', { name: 'Create proposal' }).click();
    await expect(page.locator('code').first()).toBeVisible({ timeout: 15_000 });
    const proposalText = await page.locator('code').first().innerText();
    proposalId = proposalText.trim();
    expect(Number(proposalId)).toBeGreaterThan(0);

    // Every change must be reviewed before the proposal can be finalized --
    // accept them all rather than assuming there's exactly one. The Accept
    // button stays put after being clicked (it doesn't disappear), so
    // indices stay stable across clicks.
    const changeCount = await page.getByRole('button', { name: 'Accept' }).count();
    for (let i = 0; i < changeCount; i += 1) {
      await page.getByRole('button', { name: 'Accept' }).nth(i).click();
      await expect(page.getByText('Status: accepted').nth(i)).toBeVisible();
    }

    await page.getByRole('button', { name: 'Finalize proposal' }).click();
    await expect(page.getByText(/is finalized/)).toBeVisible();
  });

  await test.step('generate a resume package', async () => {
    await page.goto('/resumes?tab=generate');
    const forms = page.locator('input[name="proposal_id"]');
    await forms.first().fill(proposalId);
    await page.getByRole('button', { name: 'Generate files' }).click();
    await expect(page.getByText('Resume package generated.')).toBeVisible({ timeout: 15_000 });
  });

  await test.step('draft and review a cover letter', async () => {
    await page.locator('input[name="proposal_id"]').last().fill(proposalId);
    await page.getByRole('button', { name: 'Create review draft' }).click();
    await expect(page.getByText('Cover letter draft is ready for review.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Paragraph 1/)).toBeVisible();
  });
});
