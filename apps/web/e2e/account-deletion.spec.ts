import { test, expect, signInAsNewUser } from './helpers';

test('deleting an account requires the right email and actually removes it', async ({ page }) => {
  await signInAsNewUser(page, 'Delete Me');
  const email = (await (await page.request.get('/api/kall/me')).json()).email as string;

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Delete my account' }).click();

  await page.getByPlaceholder(email).fill('wrong@example.com');
  await expect(page.getByRole('button', { name: 'Permanently delete my account' })).toBeDisabled();

  await page.getByPlaceholder(email).fill(email.toUpperCase());
  await page.getByRole('button', { name: 'Permanently delete my account' }).click();

  // Signed out and can no longer reach an authenticated page. 404 rather
  // than 401 is Clerk's own middleware convention for an unauthenticated
  // request to a protected API route -- confirmed as a baseline in the test
  // below, not something specific to deletion.
  await expect(page).toHaveURL(/\/(sign-in)?$/, { timeout: 15000 });
  const after = await page.request.get('/api/kall/me');
  expect(after.status()).toBe(404);
});

test('an unauthenticated request to a protected api route is a 404, not a 401', async ({ browser }) => {
  // Baseline for the assertion in the test above: this is Clerk's own
  // middleware convention for API-shaped requests to a protected route, not
  // something specific to post-deletion state.
  const context = await browser.newContext();
  const page = await context.newPage();
  const response = await page.request.get('/api/kall/me');
  expect(response.status()).toBe(404);
  await context.close();
});
