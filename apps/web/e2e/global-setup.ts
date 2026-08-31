import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { clerkSetup } from '@clerk/testing/playwright';
import { backendEnv, dbPath, repoRoot } from './env';
import { purgeTestUsers } from './purge-test-users';

/**
 * Migrations run here, synchronously, rather than chained into the uvicorn
 * webServer's own `command` -- a shell
 * `&&` chain inside a single webServer command is unreliable across platforms
 * (observed silently dropping the migration step on Windows), so give it its
 * own deterministic step instead.
 *
 * Note this does NOT run before the webServers: a CI run with no Clerk keys
 * died on "Timed out waiting from config.webServer" without these migrations
 * ever running, so webServer readiness gates this step rather than the other
 * way round. Anything that must happen before a server boots belongs in
 * e2e/env.ts, which is evaluated when the config is loaded.
 *
 * clerkSetup() fetches the testing token this run will use to bypass Clerk's
 * bot protection. The keys it needs are checked in e2e/env.ts, which runs when
 * the Playwright config is loaded -- earlier than this, and earlier than the
 * webServers whose startup depends on them.
 */
export default async function globalSetup(): Promise<void> {
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  execFileSync('python', ['-m', 'alembic', 'upgrade', 'head'], {
    cwd: repoRoot,
    env: { ...process.env, ...backendEnv },
    stdio: 'inherit',
  });

  // Per-test teardown removes users created by this run. Sweeping leftovers
  // from other runs is an explicit maintenance operation, never automatic.
  const purged = await purgeTestUsers(process.env.CLERK_SECRET_KEY as string, {
    enabled: process.env.KALL_E2E_PURGE_STALE_USERS === '1',
  });
  if (purged) console.log(`Purged ${purged} Clerk user(s) left by earlier runs.`);

  await clerkSetup();
}
