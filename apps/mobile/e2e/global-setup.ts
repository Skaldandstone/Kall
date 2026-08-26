import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { clerkSetup } from '@clerk/testing/playwright';
import { backendEnv, dbPath, repoRoot } from './env';
import { purgeTestUsers } from './purge-test-users';

/** Mirrors apps/web/e2e/global-setup.ts -- see that file for why migrations
 * run here rather than chained into the webServer's own command.
 *
 * clerkSetup() fetches the testing token this run uses to get past Clerk's
 * bot protection on sign-up. It needs a real Clerk dev instance, so fail
 * loudly here rather than letting the spec fail obscurely at its first form. */
export default async function globalSetup(): Promise<void> {
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  execFileSync('python', ['-m', 'alembic', 'upgrade', 'head'], {
    cwd: repoRoot,
    env: { ...process.env, ...backendEnv },
    stdio: 'inherit',
  });

  // Clerk dev instances cap at 100 users and this spec creates one per run.
  // Both suites share the instance, so both sweep it.
  const purged = await purgeTestUsers(process.env.CLERK_SECRET_KEY as string);
  if (purged) console.log(`Purged ${purged} Clerk user(s) left by earlier runs.`);

  await clerkSetup();
}
