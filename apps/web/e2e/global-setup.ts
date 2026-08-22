import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { backendEnv, dbPath, repoRoot } from './env';

/**
 * Runs once before either webServer starts. Migrations run here, synchronously,
 * rather than chained into the uvicorn webServer's own `command` -- a shell
 * `&&` chain inside a single webServer command is unreliable across platforms
 * (observed silently dropping the migration step on Windows), so give it its
 * own deterministic step instead.
 */
export default function globalSetup(): void {
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  execFileSync('python', ['-m', 'alembic', 'upgrade', 'head'], {
    cwd: repoRoot,
    env: { ...process.env, ...backendEnv },
    stdio: 'inherit',
  });
}
