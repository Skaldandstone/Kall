import { Page, expect, test as base } from '@playwright/test';
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright';
import path from 'node:path';

const CLERK_API = 'https://api.clerk.com/v1';

/**
 * Clerk users created by the currently running test.
 *
 * Each is deleted when its test finishes (see the `test` fixture below).
 * Without that, a dev instance's 100-user cap is reached after a handful of
 * runs and then every spec fails at sign-in with `user_quota_exceeded` -- an
 * error that names nothing relevant. The age-gated sweep in
 * purge-test-users.ts is the backstop for users a crashed run left behind;
 * this is what keeps the steady state clean.
 */
const createdUserIds: string[] = [];

async function deleteClerkUser(id: string): Promise<void> {
  await fetch(`${CLERK_API}/users/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${secretKey()}` },
  }).catch(() => undefined);
}

/**
 * Use this instead of Playwright's own `test` so the Clerk users a spec
 * creates are cleaned up even when it fails.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await use(page);
    const ids = createdUserIds.splice(0);
    await Promise.all(ids.map(deleteClerkUser));
  },
});

export { expect };
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
export async function signInAsNewUser(
  page: Page,
  fullName = 'E2E Test User',
  // The backend recognizes only this suite's narrow e2e-admin address pattern
  // when APP_ENV=test. A studio-domain address by itself never grants access.
  domain = 'example.com',
) {
  const [firstName, ...rest] = fullName.split(' ');
  const prefix = domain === 'skaldandstone.com' ? 'e2e-admin' : 'e2e';
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}+clerk_test@${domain}`;

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
  createdUserIds.push(((await response.json()) as { id: string }).id);

  // Bypasses Clerk's bot protection for this browser context.
  await setupClerkTestingToken({ page });

  // Sign in from a page that has Clerk loaded but is NOT rendering the
  // <SignIn> component: driving the client while that component owns the
  // sign-in attempt leaves the form sitting there un-submitted.
  await page.goto('/');
  await clerk.loaded({ page });

  // The user was just created through the Backend API and is being signed in
  // through the Frontend API, which does not always see it yet: CI observed
  // "Couldn't find your account" seconds after a successful create. That burnt
  // Playwright's one retry on a false failure and hid the real result, so
  // absorb the propagation lag here instead.
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await clerk.signIn({
        page,
        signInParams: { strategy: 'password', identifier: email, password: E2E_PASSWORD },
      });
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      if (!/Couldn't find your account/i.test(String(error))) throw error;
      await page.waitForTimeout(1_000 * (attempt + 1));
    }
  }
  if (lastError) throw lastError;

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

  // Activating the session redirects "/" onward -- to /onboarding for a
  // brand-new account (this is one), to /dashboard once onboarding is
  // already complete -- which tears down any in-flight evaluate; let that
  // settle before touching the page again.
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 20_000 });

  // The local User and CandidateProfile rows are created lazily on the first
  // authenticated request (kall.auth.ensure_local_user), so make one before
  // any spec assumes they exist.
  const me = await page.request.get('/api/kall/me');
  expect(me.ok(), 'first authenticated request should succeed after sign-in').toBeTruthy();

  return { email, fullName };
}

/**
 * Adds one chip to a ChipsInput field (career strategy's target roles,
 * industries, keywords, cities), which replaced plain comma-separated text
 * inputs -- type into the field labelled `label`, then press Enter to
 * commit it as a chip.
 */
export async function addChip(page: Page, label: string, value: string): Promise<void> {
  const field = page.getByLabel(label);
  await field.fill(value);
  await field.press('Enter');
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
  // Resume parsing and profile creation involve the backend and object storage.
  // Give that network boundary room on a cold CI worker without relaxing the
  // suite-wide timeout or hiding unrelated failures.
  await expect(page.getByRole('heading', { name: /where do you want your career to go/i })).toBeVisible({ timeout: 30_000 });

  await page.locator('input[name="name"]').fill(strategyName);
  await addChip(page, 'Target roles', 'Senior Backend Engineer');
  await addChip(page, 'Target roles', 'Staff Engineer');
  await addChip(page, 'Industries', 'Software');
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
 * Walks the application review page's DocumentsReviewPanel to completion:
 * accepts every proposed resume-tailoring change and finalizes it, drafts
 * and accepts the cover letter when one was requested, and generates the
 * final documents. "Confirm review items" stays disabled until all of this
 * is done (see DocumentsReviewPanel.tsx's `onReady`), so any spec that
 * reaches the review stage with the default customize-resume/generate-cover-
 * letter options needs this before it can approve an application.
 *
 * A no-op when the application requested no AI customization at all -- the
 * panel then renders "Using your original resume as-is." and there is
 * nothing to review.
 */
export async function completeDocumentsReview(page: Page) {
  if (await page.getByText('Using your original resume as-is.').isVisible().catch(() => false)) return;

  // Decision buttons disappear once a change is decided, so the button
  // count is what converges to zero here.
  async function clickUntilGone(name: string) {
    while (true) {
      const buttons = page.getByRole('button', { name });
      const count = await buttons.count();
      if (count === 0) break;
      await buttons.first().click();
      await expect(buttons).toHaveCount(count - 1, { timeout: 10_000 });
    }
  }

  const continueToLook = page.getByRole('button', { name: 'Continue to pick a look' });
  await expect(continueToLook).toBeVisible({ timeout: 15_000 });
  // The proposed changes arrive via a second fetch, after the one that
  // reveals this section at all -- querying pending count before that
  // settles reads as "nothing to accept" rather than "not loaded yet".
  await expect(page.getByText('Loading the proposed changes…')).toHaveCount(0, { timeout: 15_000 });
  // Per-role suggestions in bulk, then the summary rewrite and any
  // verified achievements one by one.
  const approveAllRoles = page.getByRole('button', { name: /^Approve all \d+$/ });
  if (await approveAllRoles.isVisible().catch(() => false)) {
    await approveAllRoles.click();
    await expect(approveAllRoles).toHaveCount(0, { timeout: 15_000 });
  }
  await clickUntilGone('Yes, add it');
  await clickUntilGone('Accept');
  await clickUntilGone('Keep');
  await expect(continueToLook).toBeEnabled();
  await continueToLook.click();
  await expect(page.getByText('Your answers are in.')).toBeVisible({ timeout: 15_000 });

  const draftCoverLetter = page.getByRole('button', { name: 'Draft cover letter' });
  if (await draftCoverLetter.isVisible().catch(() => false)) {
    await draftCoverLetter.click();
    const finalizeCoverLetter = page.getByRole('button', { name: 'Finalize cover letter' });
    await expect(finalizeCoverLetter).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Loading the cover letter\u2026')).toHaveCount(0, { timeout: 15_000 });
    // The \u00B7 escape (a middle dot) is deliberate, not decorative: the
    // literal character here was observed being silently dropped from this
    // regex somewhere in CI's TypeScript transform pipeline, which made the
    // filter match zero elements and left the accept loop a silent no-op.
    while (true) {
      const pending = page.locator('article').filter({ hasText: /\u00B7\s*pending/ });
      const count = await pending.count();
      if (count === 0) break;
      await pending.first().getByRole('button', { name: 'Accept' }).click();
      await expect(pending).toHaveCount(count - 1, { timeout: 10_000 });
    }
    await expect(finalizeCoverLetter).toBeEnabled();
    await finalizeCoverLetter.click();
    await expect(page.getByText('Cover letter finalized.')).toBeVisible({ timeout: 15_000 });
  }

  const buildResume = page.getByRole('button', { name: 'Build my resume in this look' });
  await expect(buildResume).toBeVisible({ timeout: 15_000 });
  await buildResume.click();
  await expect(page.getByRole('heading', { name: 'Read exactly what will be sent.' })).toBeVisible({ timeout: 15_000 });
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
