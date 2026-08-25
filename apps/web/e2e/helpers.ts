import { Page, APIRequestContext, expect } from '@playwright/test';
import path from 'node:path';

/**
 * Shared setup for specs that need a signed-in account past the post-signup
 * security modal. Registration itself is deliberately left inline in specs
 * that test it directly (auth.spec.ts, canonical-journey.spec.ts) so a
 * regression there is caught at the point it actually happens, but every
 * other spec just needs a account to exist and gets it here instead of
 * re-deriving the same six lines.
 */
export async function registerAndDismissModal(page: Page, email: string, password: string, fullName = 'E2E Test User') {
  await page.goto('/register');
  await page.locator('input[name="full_name"]').fill(fullName);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="password_confirmation"]').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/onboarding/);

  const dialog = page.getByRole('dialog', { name: 'Protect your Kall account' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Skip for now' }).click();
  await expect(dialog).not.toBeVisible();

  const token = await page.evaluate(() => localStorage.getItem('kall_token'));
  if (!token) throw new Error('Registration did not produce a session token.');
  return token;
}

/**
 * Completes onboarding's resume-upload + career-strategy steps, which is
 * what actually creates the professional profile most other flows (search,
 * job intelligence, tailoring, applications) require to function.
 */
export async function completeOnboarding(page: Page, strategyName = 'Backend Leadership') {
  await page.setInputFiles('input[type="file"][name="file"]', path.join(__dirname, 'fixtures', 'sample-resume.txt'));
  await page.getByRole('button', { name: 'Upload resume' }).click();
  await expect(page.getByRole('heading', { name: /where do you want your career to go/i })).toBeVisible();

  await page.locator('input[name="name"]').fill(strategyName);
  await page.locator('textarea[name="target_titles"]').fill('Senior Backend Engineer, Staff Engineer');
  await page.locator('input[name="industries"]').fill('Software');
  await page.getByRole('button', { name: 'Save strategy' }).click();
  await expect(page.getByRole('heading', { name: /workspace is prepared/i })).toBeVisible();
}

/** Seeds an importable job the same way canonical-journey.spec.ts does, via the same endpoint the real "Apply with Kall" flow uses for an external search result. */
export async function seedJob(request: APIRequestContext, baseURL: string, token: string, overrides: Record<string, unknown> = {}) {
  const unique = Date.now();
  const response = await request.post(`${baseURL}/api/kall/jobs/import-search-result`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      url: `https://boards.example.com/jobs/${unique}`,
      title: 'Senior Backend Engineer',
      company: 'Acme Robotics',
      snippet: 'Own distributed systems powering our fulfillment network.',
      source: 'e2e',
      ...overrides,
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}
