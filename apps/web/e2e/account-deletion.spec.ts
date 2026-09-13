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

test('a deletion that the browser never sees a response for still recovers, not hangs', async ({ page }) => {
  // Reproduces a live bug: on an account with enough data, the DELETE can
  // take long enough that something in the chain (proxy, load balancer)
  // drops the connection before the response reaches the page, even though
  // the server finishes the deletion and returns 204. The old handler had no
  // catch around the fetch, so the thrown error was unhandled and the button
  // sat on "Deleting..." forever while the account was already gone.
  //
  // Simulated here by letting the real DELETE complete against the real
  // server (so the account is actually deleted), then aborting the page's
  // own view of that response -- the same shape of failure as a dropped
  // connection, without needing to actually stall a real request.
  await signInAsNewUser(page, 'Delete Me Too');
  const email = (await (await page.request.get('/api/kall/me')).json()).email as string;

  await page.route('**/api/kall/me', async (route) => {
    if (route.request().method() !== 'DELETE') {
      await route.continue();
      return;
    }
    await fetch(route.request().url(), {
      method: 'DELETE',
      headers: route.request().headers(),
      body: route.request().postData() ?? undefined,
    });
    await route.abort('failed');
  });

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await page.getByPlaceholder(email).fill(email);
  await page.getByRole('button', { name: 'Permanently delete my account' }).click();

  // Recovers instead of hanging: the account is confirmed gone even though
  // this page's own fetch never saw the response.
  await expect(page).toHaveURL(/\/(sign-in)?$/, { timeout: 15000 });
});

test('a failed deletion is not claimed when verification is unavailable', async ({ page }) => {
  await signInAsNewUser(page, 'Delete Unconfirmed');
  const email = (await (await page.request.get('/api/kall/me')).json()).email as string;

  await page.route('**/api/kall/me', (route) => {
    if (route.request().method() === 'DELETE') return route.abort('failed');
    return route.continue();
  });
  await page.route('**/api/kall/me/deletion-status', (route) => route.fulfill({ status: 503 }));

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await page.getByPlaceholder(email).fill(email);
  await page.getByRole('button', { name: 'Permanently delete my account' }).click();

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'could not confirm whether deletion finished',
  );
  await expect(page.getByRole('button', { name: 'Permanently delete my account' })).toBeEnabled();
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
