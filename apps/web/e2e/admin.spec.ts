import { test, expect, signInAsNewUser } from './helpers';

/**
 * The support console. Access is by verified email domain, so the tests that
 * matter are the ones about who is turned away: an admin surface that leaks
 * is worse than one that does not exist.
 */
test('an ordinary account is told the console is not available', async ({ page }) => {
  await signInAsNewUser(page, 'Ordinary User');

  // The API refuses first, and the page says so rather than showing an empty
  // console someone might mistake for a broken screen.
  const refused = await page.request.get('/api/kall/admin/users');
  expect(refused.status()).toBe(404);

  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Not available' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Set premium/ })).toHaveCount(0);

  // And nothing anywhere points them at it.
  await page.goto('/applications');
  await expect(
    page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Support' }),
  ).toHaveCount(0);
});

test('an admin reaches the console from the nav', async ({ page }) => {
  await signInAsNewUser(page, 'Kall Admin', 'skaldandstone.com');
  await page.goto('/applications');

  await page
    .getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link', { name: 'Support' })
    .click();

  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
});

test('an admin can change a plan, exempt an account, and see it logged', async ({ page, browser }) => {
  // A separate ordinary account to act on.
  const victimContext = await browser.newContext();
  const victimPage = await victimContext.newPage();
  const { email: targetEmail } = await signInAsNewUser(victimPage, 'Target Account');
  await victimContext.close();

  await signInAsNewUser(page, 'Kall Admin', 'skaldandstone.com');
  await page.goto('/admin');

  await test.step('find the account', async () => {
    await page.locator('input[name="q"]').fill(targetEmail);
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByText(targetEmail).click();
    await expect(page.getByRole('heading', { name: 'Target Account' })).toBeVisible();
  });

  await test.step('a free account starts on the free limits', async () => {
    await expect(page.getByText('0 / 5')).toBeVisible();
  });

  await test.step('change the plan, with a reason', async () => {
    await page.locator('input[name="reason"]').fill('Comped for feedback');
    await page.getByRole('button', { name: 'Set premium' }).click();
    // Premium has no application ceiling.
    await expect(page.getByText('0 (no limit)')).toBeVisible();
  });

  await test.step('the reason does not carry over to the next action', async () => {
    // Each logged change must carry a justification written for it, not one
    // inherited from the previous action.
    await expect(page.locator('input[name="reason"]')).toHaveValue('');
    await page.locator('input[name="reason"]').fill('Dev account');
    await page.getByRole('button', { name: 'Exempt from limits' }).click();
    await expect(page.getByRole('button', { name: 'Remove exemption' })).toBeVisible();
  });

  await test.step('both changes are in the history, with who and why', async () => {
    const history = page.locator('section', { hasText: 'History' }).last();
    await expect(history.getByText('set plan')).toBeVisible();
    await expect(history.getByText('set billing exempt')).toBeVisible();
    // Each entry carries its own reason, not a shared one.
    await expect(history.getByText('Comped for feedback')).toBeVisible();
    await expect(history.getByText('Dev account')).toBeVisible();
    await expect(history.getByText(/@skaldandstone\.com/).first()).toBeVisible();
  });
});
