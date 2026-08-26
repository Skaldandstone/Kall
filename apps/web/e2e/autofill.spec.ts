import { test, expect, signInAsNewUser, completeOnboarding, seedJob, firstProfileId } from './helpers';

/**
 * One-click apply: Kall pre-fills the employer's form, the user submits it
 * themselves. This drives the whole chain -- add a role, prepare and approve
 * an application, then assert the panel fills what it should, withholds what
 * it should, and explains every omission.
 *
 * The consent behaviour is the part worth guarding: work authorization must
 * arrive un-answered ("Prefer not to answer") until the user turns it on for
 * this specific application, and opt-in fields like phone must stay withheld
 * until a privacy rule grants them.
 */
test('the autofill panel fills consented fields and withholds the rest', async ({ page }) => {
  const unique = Date.now();
  await signInAsNewUser(page, 'Ada Lovelace');
  await completeOnboarding(page);

  await test.step('save identity details and a current role', async () => {
    await page.goto('/profiles?tab=identity');
    await expect(page.locator('input[name="preferred_name"]')).toHaveValue('Ada Lovelace');
    await page.locator('input[name="city"]').fill('Austin');
    await page.locator('input[name="linkedin_url"]').fill('https://linkedin.com/in/ada');
    await page.getByRole('button', { name: 'Save identity' }).click();
    await expect(page.getByText('Identity saved.')).toBeVisible();

    await page.goto('/profiles?tab=employment');
    await page.locator('input[name="employer"]').fill('Northwind Systems');
    await page.locator('input[name="job_title"]').fill('Senior Backend Engineer');
    await page.locator('input[name="start_date"]').fill('2020-01-01');
    await page.locator('input[name="is_current"]').check();
    await page.getByRole('button', { name: 'Add role' }).click();
    await expect(page.getByText('Role saved.')).toBeVisible();
    // Plain calendar dates must not shift a year across time zones.
    await expect(page.getByText('2020 – Present')).toBeVisible();
  });

  await test.step('record work authorization', async () => {
    const response = await page.request.put(`/api/kall/profile/work-authorization`, {
      data: {
        country: 'United States', authorization_type: 'Citizen', citizenship_status: 'US Citizen',
        requires_current_sponsorship: false, requires_future_sponsorship: false,
      },
    });
    expect(response.ok()).toBeTruthy();
  });

  const profileId = await firstProfileId(page);
  const job = await seedJob(page);

  await test.step('prepare and approve an application', async () => {
    await page.goto(`/applications/new?job=${job.id}&profile=${profileId}`);
    // Both selects populate from a fetch. Clicking before the resume one
    // resolves sends resume_id: null and silently produces an application
    // with no resume -- which then fails much later, at the autofill step.
    await expect(page.getByRole('button', { name: 'Prepare application' })).toBeEnabled();
    await expect(page.locator('select').nth(1)).not.toHaveValue('');
    await page.getByRole('button', { name: 'Prepare application' }).click();
    await expect(page.getByRole('link', { name: 'Continue to application review' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('link', { name: 'Continue to application review' }).click();
    await page.getByRole('button', { name: 'Confirm review items' }).click();
    await expect(page.getByText('All required review items are complete.')).toBeVisible();
    await page.getByRole('button', { name: 'Approve application package' }).click();
    await expect(page.getByText('Stage: approved')).toBeVisible({ timeout: 15_000 });
  });

  await test.step('identity and work history are filled automatically', async () => {
    await expect(page.getByRole('heading', { name: 'What Kall will fill in for you' })).toBeVisible();
    await expect(page.getByText('Ada Lovelace')).toBeVisible();
    await expect(page.getByText('https://linkedin.com/in/ada')).toBeVisible();
    await expect(page.getByText('Northwind Systems')).toBeVisible();
  });

  await test.step('work authorization is withheld until confirmed for this application', async () => {
    await expect(page.getByRole('heading', { name: /Needs your confirmation \(0 of/ })).toBeVisible();
    await expect(page.getByText('Prefer not to answer').first()).toBeVisible();

    const row = page.locator('label').filter({ hasText: 'Work authorization' });
    await row.locator('input[type="checkbox"]').check();
    await expect(page.getByRole('heading', { name: /Needs your confirmation \(1 of/ })).toBeVisible();
    await expect(row.getByText('Citizen')).toBeVisible();
  });

  await test.step('opt-in fields are withheld with a stated reason', async () => {
    const omitted = page.locator('section').filter({ hasText: 'Not filled' });
    await expect(omitted.getByText('Not enabled for autofill in your privacy settings.').first()).toBeVisible();
  });

  await test.step('the resume is attached', async () => {
    await expect(page.getByText(/will be attached/)).toBeVisible();
  });
});
