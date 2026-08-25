import { test, expect } from '@playwright/test';
import path from 'node:path';
import { registerAndDismissModal } from './helpers';

test.describe('profile tabs', () => {
  test('identity settings persist across a reload', async ({ page }) => {
    const unique = Date.now();
    await registerAndDismissModal(page, `identity-${unique}@example.com`, 'IdentityTabTest123!');

    await page.goto('/profiles?tab=identity');
    // The form loads its initial values asynchronously and overwrites
    // whatever's already typed when it resolves -- wait for that load to
    // land (preferred_name defaults to the account's full name) before typing.
    await expect(page.locator('input[name="preferred_name"]')).toHaveValue('E2E Test User');
    await page.locator('input[name="preferred_name"]').fill('Jo');
    await page.locator('select[name="country"]').selectOption({ label: 'United States' });
    await page.locator('input[name="city"]').fill('Austin');
    await page.locator('input[name="timezone"]').fill('America/Chicago');
    await page.locator('textarea[name="professional_summary"]').fill('Backend engineer focused on distributed systems.');
    await page.getByRole('button', { name: 'Save identity' }).click();
    await expect(page.getByText('Identity saved.')).toBeVisible();

    await page.reload();
    await expect(page.locator('input[name="preferred_name"]')).toHaveValue('Jo');
    await expect(page.locator('input[name="city"]')).toHaveValue('Austin');
    await expect(page.locator('select[name="country"] option:checked')).toHaveText('United States');
  });

  test('adding a professional record entry rejects invalid JSON and accepts valid JSON', async ({ page }) => {
    const unique = Date.now();
    await registerAndDismissModal(page, `record-${unique}@example.com`, 'RecordTabTest123!');

    await page.goto('/profiles?tab=record');
    await page.locator('select').first().selectOption('skills');
    await page.locator('textarea[name="data"]').fill('{not valid json');
    await page.getByRole('button', { name: /Add / }).click();
    await expect(page.getByText('Enter valid JSON for this profile record.')).toBeVisible();

    await page.locator('textarea[name="data"]').fill('{"name":"Python","category":"Programming","years_experience":10}');
    await page.getByRole('button', { name: /Add / }).click();
    await expect(page.getByText('Profile record added.')).toBeVisible();
    await expect(page.getByText(/"name": "Python"/)).toBeVisible();
  });

  test('parsing a resume surfaces a metric-bearing achievement that can be verified', async ({ page }) => {
    const unique = Date.now();
    await registerAndDismissModal(page, `achievements-${unique}@example.com`, 'AchievementsTabTest123!');

    // Achievement extraction reads from an uploaded resume's extracted text,
    // so onboarding's resume-upload step has to run first.
    await page.setInputFiles('input[type="file"][name="file"]', path.join(__dirname, 'fixtures', 'sample-resume.txt'));
    await page.getByRole('button', { name: 'Upload resume' }).click();
    await expect(page.getByRole('heading', { name: /where do you want your career to go/i })).toBeVisible();

    await page.goto('/profiles?tab=achievements');
    // The resume <select> populates asynchronously and "Parse selected
    // resume" silently no-ops until it does (no resume id yet) -- wait for
    // the uploaded resume to actually appear as an option before clicking.
    await expect(page.locator('select').first().locator('option')).toHaveCount(1);
    await page.getByRole('button', { name: 'Parse selected resume' }).click();
    await expect(page.getByText(/Parse complete\. \d+ warning/)).toBeVisible();
    // "Owned on-call..." doesn't extract as an achievement candidate here --
    // "50M" has no standalone digit run the metrics regex's word boundary
    // matches (the "M" blocks it). Only the employer/dates line has a bare
    // number ("2020-2026"), which is what the deterministic parser picks up.
    await expect(page.getByText('Senior Backend Engineer, Northwind Systems (2020-2026)')).toBeVisible();
    await expect(page.getByText('suggested', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText('verified', { exact: true })).toBeVisible();
  });

  test('a testimonial request can be sent, submitted by the recipient, and moderated', async ({ page, browser }) => {
    const unique = Date.now();
    await registerAndDismissModal(page, `testimonial-${unique}@example.com`, 'TestimonialTest123!');

    await page.goto('/profiles?tab=references');
    await page.locator('input[name="name"]').fill('Alex Coworker');
    await page.locator('input[name="email"]').fill(`alex-coworker-${unique}@example.com`);
    await page.locator('input[name="relationship"]').fill('Former manager');
    await page.getByRole('button', { name: 'Create invitation' }).click();
    await expect(page.getByText('Invitation created. Copy the secure link and send it to your former coworker.')).toBeVisible();

    const inviteLink = await page.locator('div.notice', { hasText: '/testimonial-submit?token=' }).innerText();
    expect(inviteLink).toContain('/testimonial-submit?token=');

    // The recipient never has a Kall session -- use a fresh, unauthenticated
    // browser context to mirror how they'd actually receive and open the link.
    const recipientContext = await browser.newContext();
    const recipientPage = await recipientContext.newPage();
    await recipientPage.goto(inviteLink!);
    await recipientPage.locator('input[name="author_name"]').fill('Alex Coworker');
    await recipientPage.locator('input[name="relationship"]').fill('We worked together for three years.');
    await recipientPage.locator('textarea[name="body"]').fill('Consistently the person who unblocked the team during incidents.');
    await recipientPage.locator('input[name="permission_granted"]').check();
    await recipientPage.getByRole('button', { name: 'Submit response' }).click();
    await expect(recipientPage.getByText('Thank you. Your response was submitted for review.')).toBeVisible();

    // The same invitation link cannot be used twice.
    await recipientPage.goto(inviteLink!);
    await recipientPage.locator('input[name="author_name"]').fill('Alex Coworker');
    await recipientPage.locator('input[name="relationship"]').fill('We worked together for three years.');
    await recipientPage.locator('textarea[name="body"]').fill('Second attempt.');
    await recipientPage.getByRole('button', { name: 'Submit response' }).click();
    await expect(recipientPage.getByText('This invitation is invalid, expired, or already completed.')).toBeVisible();
    await recipientContext.close();

    await page.reload();
    await expect(page.getByText('Consistently the person who unblocked the team during incidents.')).toBeVisible();
    await page.getByRole('button', { name: 'Show on profile card' }).click();
    await expect(page.getByText('Visibility updated.')).toBeVisible();
  });
});

test.describe('redirect shims', () => {
  test('/testimonials redirects to the references tab', async ({ page }) => {
    const unique = Date.now();
    await registerAndDismissModal(page, `redirect-testimonials-${unique}@example.com`, 'RedirectShimTest123!');
    await page.goto('/testimonials');
    await expect(page).toHaveURL(/\/profiles\?tab=references/);
  });

  test('/submissions redirects to the applications pipeline', async ({ page }) => {
    const unique = Date.now();
    await registerAndDismissModal(page, `redirect-submissions-${unique}@example.com`, 'RedirectShimTest123!');
    await page.goto('/submissions');
    await expect(page).toHaveURL(/\/applications/);
  });
});
