import { clerk } from '@clerk/testing/playwright';
import { test, expect, signInAsNewUser } from './helpers';

/**
 * Kall's side of the auth boundary now that Clerk owns identity.
 *
 * Deliberately does NOT test password rules, lockout, MFA or social sign-in:
 * none of that is Kall's code any more, and asserting on it would only test
 * Clerk. What remains ours is the wiring -- which routes are protected, that
 * signing out really ends access, and that the proxy hands the API a token
 * derived from the session rather than from anything the client supplies.
 */
test.describe('authentication boundary', () => {
  test('a signed-out visitor cannot reach a protected page or the API', async ({ page }) => {
    const health = await page.request.get('/api/kall/health');
    expect(health.status()).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok', product: 'Kall' });

    await page.goto('/applications');
    // Clerk's middleware redirects to Kall's own sign-in, not its hosted
    // accounts.dev domain, and preserves where the visitor was heading.
    await expect(page).toHaveURL(/\/sign-in/);
    expect(new URL(page.url()).searchParams.get('redirect_url')).toContain('/applications');

    const api = await page.request.get('/api/kall/me');
    expect(api.ok()).toBeFalsy();
  });

  test('the marketing page, beta install guide, and a testimonial invitation stay public', async ({ page }) => {
    const mobileRelease = await page.request.get('/api/mobile-release');
    expect(mobileRelease.ok()).toBeTruthy();
    expect(await mobileRelease.json()).toEqual({
      platform: 'android',
      latestVersion: '1.1.2',
      updateUrl: 'https://play.google.com/apps/testing/com.skaldandstone.kall',
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Know what you can do next.' })).toBeVisible();

    await page.getByRole('link', { name: /Install on Google Play/ }).click();
    await expect(page.getByRole('heading', { name: 'Get Kall on your phone.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign up for the beta' })).toHaveAttribute(
      'href',
      'https://forms.gle/ZbqaLtAt7gVvVoiQ8',
    );
    await expect(page.getByRole('link', { name: 'Join the Google Play test' })).toHaveAttribute(
      'href',
      'https://play.google.com/apps/testing/com.skaldandstone.kall',
    );
    await expect(page.getByRole('link', { name: 'Open your tester download' })).toHaveAttribute(
      'href',
      'https://play.google.com/apps/testing/com.skaldandstone.kall',
    );
    await page.getByText('Can’t access the test or install the app?').click();
    await expect(page.getByText(/If Google says “Not Found”/)).toBeVisible();

    // Opened by a former colleague from an emailed link, so it must work with
    // no Kall account at all.
    await page.goto('/testimonial-submit?token=not-a-real-token');
    await expect(page.getByRole('heading', { name: /Share what it was like/i })).toBeVisible();
  });

  test('signing in, then out, ends access to the API', async ({ page }) => {
    await signInAsNewUser(page, 'Session Boundary Test');

    const signedIn = await page.request.get('/api/kall/me');
    expect(signedIn.ok()).toBeTruthy();

    await clerk.signOut({ page });

    const signedOut = await page.request.get('/api/kall/me');
    expect(signedOut.ok()).toBeFalsy();
  });

  test('the browser never holds a session token of its own', async ({ page }) => {
    await signInAsNewUser(page, 'Token Storage Test');

    // The whole point of moving to Clerk's httpOnly cookie: script injection
    // cannot read the session out of storage, because it is not there.
    const stored = await page.evaluate(() => ({
      local: Object.keys(window.localStorage),
      session: Object.keys(window.sessionStorage),
    }));
    expect(stored.local.join(',')).not.toContain('kall_token');
    expect(stored.session.join(',')).not.toContain('kall_token');

    // And the app still works without one, because the proxy supplies it.
    const me = await page.request.get('/api/kall/me');
    expect(me.ok()).toBeTruthy();
  });

  test('the proxy does not forward a client-supplied Authorization header', async ({ page }) => {
    // A garbage bearer token must not reach the API. If it were forwarded,
    // FastAPI would answer with its own JSON 401; instead Clerk sees no valid
    // session and the request never gets past the middleware.
    const response = await page.request.get('/api/kall/me', {
      headers: { Authorization: 'Bearer not.a.real.token' },
    });
    expect(response.ok()).toBeFalsy();
    expect(await response.text()).not.toContain('Invalid or expired session');
  });
});
