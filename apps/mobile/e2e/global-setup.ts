import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { clerkSetup } from '@clerk/testing/playwright';
import { backendEnv, dbPath, repoRoot } from './env';

/** Mirrors apps/web/e2e/global-setup.ts -- see that file for why migrations
 * run here rather than chained into the webServer's own command.
 *
 * clerkSetup() fetches the testing token this run uses to get past Clerk's
 * bot protection on sign-up. It needs a real Clerk dev instance, so fail
 * loudly here rather than letting the spec fail obscurely at its first form. */
export default async function globalSetup(): Promise<void> {
  const missing = ['CLERK_SECRET_KEY', 'EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY'].filter(
    (name) => !process.env[name],
  );
  if (missing.length) {
    throw new Error(
      `Missing ${missing.join(' and ')}. Identity lives in Clerk, so this test needs a real ` +
        'Clerk dev instance: the keys are picked up from apps/web/.env.local locally, and must ' +
        'be set as repository secrets in CI.',
    );
  }

  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  execFileSync('python', ['-m', 'alembic', 'upgrade', 'head'], {
    cwd: repoRoot,
    env: { ...process.env, ...backendEnv },
    stdio: 'inherit',
  });

  await clerkSetup();
}
