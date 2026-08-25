import { Page, expect } from '@playwright/test';
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright';
import path from 'node:path';

const CLERK_API = 'https://api.clerk.com/v1';
const E2E_PASSWORD = 'KallE2ePassword!2026';

function secretKey() {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) {
    throw new Error(
      'CLERK_SECRET_KEY is required to run these tests. Identity lives in Clerk now, ' +
        'so e2e needs a real Clerk dev instance -- see apps/web/.env.local locally, ' +
        'or the repository secret in CI.',
    );
  }
  return key;
}

/**
 * Creates a fresh Clerk user and signs the browser in as them.
 *
 * Every spec used to register through Kall's own /register form. Sign-up now
 * happens inside Clerk, so tests create the user through Clerk's Backend API
 * and sign in with Clerk's Playwright helper instead of driving its UI --
 * driving a third party's markup would make this suite break whenever Clerk
 * ships a design change.
 *
 * Emails use Clerk's `+clerk_test` convention: those accounts skip the
 * email-code check that would otherwise block a sign-in from an unrecognised
 * device, which is unreachable from a test runner.
 */
export async function signInAsNewUser(page: Page, fullName = 'E2E Test User') {
  const [firstName, ...rest] = fullName.split(' ');
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}+clerk_test@example.com`;

  const response = await fetch(`${CLERK_API}/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secretKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email_address: [email],
      password: E2E_PASSWORD,
      first_name: firstName,
      last_name: rest.join(' ') || 'User',
      skip_password_checks: true,
    }),
  });
  if (!response.ok) {
    throw new Error(`Could not create a Clerk test user: ${response.status} ${await response.text()}`);
  }

  // Bypasses Clerk's bot protection for this browser context.
  await setupClerkTestingToken({ page });

  // Sign in from a page that has Clerk loaded but is NOT rendering the
  // <SignIn> component: driving the client while that component owns the
  // sign-in attempt leaves the form sitting there un-submitted.
  await page.goto('/');
  await clerk.loaded({ page });
  await clerk.signIn({
    page,
    signInParams: { strategy: 'password', identifier: email, password: E2E_PASSWORD },
  });

  // The instance verifies unrecognised devices, so password alone leaves the
  // sign-in at `needs_client_trust` -- silently, with no error thrown, which
  // is why this is worth handling explicitly rather than assuming success.
  // `+clerk_test` addresses accept Clerk's fixed code, so the factor can be
  // completed without a mailbox. Guarded on status so this stays correct if
  // device verification is ever turned off for the instance.
  await page.evaluate(async () => {
    const clerkClient = (window as { Clerk?: any }).Clerk;
    const signIn = clerkClient?.client?.signIn;
    if (!signIn || signIn.status === 'complete') return;
    await signIn.prepareSecondFactor({ strategy: 'email_code' });
    const result = await signIn.attemptSecondFactor({ strategy: 'email_code', code: '424242' });
    if (result?.createdSessionId) await clerkClient.setActive({ session: result.createdSessionId });
  });

  // Activating the session redirects "/" to /dashboard, which tears down any
  // in-flight evaluate; let that settle before touching the page again.
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });

  // The local User and CandidateProfile rows are created lazily on the first
  // authenticated request (kall.auth.ensure_local_user), so make one before
  // any spec assumes they exist.
  const me = await page.request.get('/api/kall/me');
  expect(me.ok(), 'first authenticated request should succeed after sign-in').toBeTruthy();

  return { email, fullName };
}

/**
 * Completes onboarding's resume-upload + career-strategy steps, which is
 * what actually creates the professional profile most other flows (search,
 * job intelligence, tailoring, applications) require to function.
 */
export async function completeOnboarding(page: Page, strategyName = 'Backend Leadership') {
  await page.goto('/onboarding');
  await page.setInputFiles('input[type="file"][name="file"]', path.join(__dirname, 'fixtures', 'sample-resume.txt'));
  await page.getByRole('button', { name: 'Upload resume' }).click();
  await expect(page.getByRole('heading', { name: /where do you want your career to go/i })).toBeVisible();

  await page.locator('input[name="name"]').fill(strategyName);
  await page.locator('textarea[name="target_titles"]').fill('Senior Backend Engineer, Staff Engineer');
  await page.locator('input[name="industries"]').fill('Software');
  await page.getByRole('button', { name: 'Save strategy' }).click();
  await expect(page.getByRole('heading', { name: /workspace is prepared/i })).toBeVisible();
}

/** The signed-in user's professional profile id, which most flows need. */
export async function firstProfileId(page: Page): Promise<number> {
  const response = await page.request.get('/api/kall/me/professional-profiles');
  expect(response.ok()).toBeTruthy();
  return (await response.json())[0].id;
}

/**
 * Seeds an importable job through the same endpoint the real "Apply with
 * Kall" flow uses for an external search result.
 *
 * Uses page.request rather than the standalone `request` fixture: it carries
 * the browser's Clerk cookie, so the call authenticates through the /api/kall
 * proxy exactly as the app's own fetches do. No bearer token to pass around.
 */
export async function seedJob(page: Page, overrides: Record<string, unknown> = {}) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await page.request.post('/api/kall/jobs/import-search-result', {
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
