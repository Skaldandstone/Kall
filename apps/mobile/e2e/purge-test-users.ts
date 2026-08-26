/**
 * Mirror of apps/web/e2e/purge-test-users.ts. Duplicated rather than imported
 * because the two apps are separate npm packages with their own tsconfigs;
 * keep the two in sync if the email pattern changes.
 *
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
 */
const CLERK_API = 'https://api.clerk.com/v1';
const TEST_EMAIL = /^(e2e|mobile-smoke)-[^@]*\+clerk_test@example\.com$/;

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
  if (now - user.created_at < MIN_AGE_MS) return false;
  return user.email_addresses.some((row) => TEST_EMAIL.test(row.email_address));
}

export async function purgeTestUsers(secretKey: string): Promise<number> {
  const headers = { Authorization: `Bearer ${secretKey}` };
  const now = Date.now();
  let deleted = 0;

  // Paginate: the cap is 100 users but the default page size is smaller, and
  // a partial sweep would leave the instance full for the next run.
  for (let offset = 0; ; offset += 100) {
    const response = await fetch(`${CLERK_API}/users?limit=100&offset=${offset}`, { headers });
    if (!response.ok) {
      throw new Error(`Could not list Clerk users: ${response.status} ${await response.text()}`);
    }
    const page: ClerkUser[] = await response.json();
    if (!page.length) break;

    for (const user of page.filter((user) => isCollectable(user, now))) {
      const removal = await fetch(`${CLERK_API}/users/${user.id}`, { method: 'DELETE', headers });
      // A 404 means something else already removed it; that is the goal state.
      if (removal.ok || removal.status === 404) deleted += 1;
    }
    if (page.length < 100) break;
  }
  return deleted;
}
