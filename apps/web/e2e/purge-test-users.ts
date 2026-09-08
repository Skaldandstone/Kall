/**
 * Deletes the Clerk users this suite creates.
 *
 * Each spec makes a fresh user through Clerk's Backend API and nothing used to
 * remove them, so a dev instance silently filled up and then started returning
 * `user_quota_exceeded` (100-user cap) -- which fails every spec at sign-in and
 * looks nothing like a quota problem. Purging at the start of a run, rather
 * than after each test, also cleans up behind a crashed or cancelled run.
 *
 * The pattern is deliberately narrow: only addresses this suite generates.
 * A real account signed into the same dev instance must never be touched.
 * Stale-user cleanup is disabled unless the caller explicitly opts in.
 */
const CLERK_API = 'https://api.clerk.com/v1';
const TEST_EMAIL = /^(?:(?:e2e|mobile-smoke)-[^@]*\+clerk_test@example\.com|e2e-admin-[0-9]+-[a-z0-9]{6}\+clerk_test@skaldandstone\.com)$/;

type ClerkUser = {
  id: string;
  created_at: number;
  email_addresses: { id: string; email_address: string }[];
  primary_email_address_id: string | null;
};

/**
 * Never touch a user younger than this.
 *
 * The web and mobile e2e jobs run in parallel against the same Clerk
 * instance, and both match the same address pattern -- so without an age
 * floor one job's sweep deletes the other job's live users mid-run, which
 * surfaces as an unrelated "Couldn't find your account" sign-in failure. The
 * same applies to two runs of the same suite from concurrent pull requests.
 * A job takes minutes; leftovers worth collecting are hours old.
 */
const MIN_AGE_MS = 60 * 60 * 1000;

function isCollectable(user: ClerkUser, now: number): boolean {
  if (!Number.isFinite(user.created_at) || now - user.created_at < MIN_AGE_MS) return false;
  // An actual user's account can have a test-looking secondary address.
  // Delete only identities whose primary and every address are test addresses.
  return user.email_addresses.length > 0
    && user.email_addresses.some((row) => row.id === user.primary_email_address_id)
    && user.email_addresses.every((row) => TEST_EMAIL.test(row.email_address));
}

export function assertDevelopmentKeys(secretKey: string, publishableKey?: string): void {
  if (!secretKey.startsWith('sk_test_')
      || (publishableKey !== undefined && !publishableKey.startsWith('pk_test_'))) {
    throw new Error('Clerk E2E requires development keys (sk_test_ and pk_test_). Production keys are refused.');
  }
}

export async function purgeTestUsers(
  secretKey: string,
  { enabled = false }: { enabled?: boolean } = {},
): Promise<number> {
  // A default test run must never sweep the shared development instance.
  if (!enabled) return 0;
  assertDevelopmentKeys(secretKey);
  const headers = { Authorization: `Bearer ${secretKey}` };
  const now = Date.now();
  let deleted = 0;
  const candidates: ClerkUser[] = [];

  // Paginate: the cap is 100 users but the default page size is smaller, and
  // a partial sweep would leave the instance full for the next run.
  for (let offset = 0; ; offset += 100) {
    const response = await fetch(`${CLERK_API}/users?limit=100&offset=${offset}`, { headers });
    if (!response.ok) {
      throw new Error(`Could not list Clerk test users: HTTP ${response.status}`);
    }
    const page: ClerkUser[] = await response.json();
    if (!page.length) break;

    candidates.push(...page.filter((user) => isCollectable(user, now)));
    if (page.length < 100) break;
  }
  // Collect the complete snapshot before deleting, so deleting page one cannot
  // shift later users under the pagination offset and silently miss them.
  for (const user of candidates) {
    const removal = await fetch(`${CLERK_API}/users/${encodeURIComponent(user.id)}`, { method: 'DELETE', headers });
    if (!removal.ok && removal.status !== 404) {
      throw new Error(`Could not remove a Clerk test user: HTTP ${removal.status}`);
    }
    deleted += 1;
  }
  return deleted;
}
