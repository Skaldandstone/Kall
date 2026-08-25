import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { clerkSetup } from '@clerk/testing/playwright';
import { backendEnv, dbPath, repoRoot } from './env';
import { purgeTestUsers } from './purge-test-users';

/**
 * Runs once before either webServer starts. Migrations run here, synchronously,
 * rather than chained into the uvicorn webServer's own `command` -- a shell
 * `&&` chain inside a single webServer command is unreliable across platforms
 * (observed silently dropping the migration step on Windows), so give it its
 * own deterministic step instead.
 *
 * clerkSetup() fetches the testing token this run will use to bypass Clerk's
 * bot protection. It needs a real Clerk dev instance, so CLERK_SECRET_KEY and
 * NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must be present -- fail loudly here rather
 * than letting every spec fail one-by-one at its sign-in step.
 */
export default async function globalSetup(): Promise<void> {
  const missing = ['CLERK_SECRET_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'].filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(
      `Missing ${missing.join(' and ')}. Identity lives in Clerk, so these tests need a real ` +
        'Clerk dev instance: they are in apps/web/.env.local locally, and must be set as ' +
        'repository secrets in CI.',
    );
  }

  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  execFileSync('python', ['-m', 'alembic', 'upgrade', 'head'], {
    cwd: repoRoot,
    env: { ...process.env, ...backendEnv },
    stdio: 'inherit',
  });

  // Clerk dev instances cap at 100 users and every spec creates one, so
  // without this the suite works for a handful of runs and then fails
  // everywhere at once with an error that does not mention quotas.
  const purged = await purgeTestUsers(process.env.CLERK_SECRET_KEY as string);
  if (purged) console.log(`Purged ${purged} Clerk user(s) left by earlier runs.`);

  await clerkSetup();
}
