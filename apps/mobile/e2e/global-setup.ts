import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { backendEnv, dbPath, repoRoot } from './env';

/** Mirrors apps/web/e2e/global-setup.ts -- see that file for why migrations
 * run here rather than chained into the webServer's own command. */
export default function globalSetup(): void {
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  execFileSync('python', ['-m', 'alembic', 'upgrade', 'head'], {
    cwd: repoRoot,
    env: { ...process.env, ...backendEnv },
    stdio: 'inherit',
  });
}
