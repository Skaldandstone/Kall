import fs from 'node:fs';
import path from 'node:path';

export const repoRoot = path.resolve(__dirname, '..', '..', '..');
export const webRoot = path.resolve(__dirname, '..');
export const dbPath = path.join(repoRoot, 'e2e-canonical-journey.db');

/**
 * Next.js loads .env.local for the dev server it runs, but the Playwright
 * process itself gets no such treatment -- and global setup, the helpers that
 * create Clerk users, and the backend all need the Clerk keys. Read the file
 * directly rather than adding a dotenv dependency for four lines. Anything
 * already in the real environment wins, so CI secrets are not overwritten.
 */
function loadEnvLocal(): void {
  const file = path.join(webRoot, '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, '');
  }
}

loadEnvLocal();

/**
 * Fail immediately, and legibly, when the Clerk keys are absent.
 *
 * This runs at config-load time on purpose. Playwright waits for every
 * `webServer` to become healthy before it runs globalSetup, and without a
 * publishable key the Next.js server 500s on every request and never becomes
 * healthy -- so the run died after 60s on "Timed out waiting from
 * config.webServer", preceded by a wall of Clerk stack traces, with nothing
 * anywhere naming the actual cause.
 *
 * Deliberately a hard failure rather than skipping the suite. A skip would
 * turn this into a green check that proves nothing, and these specs have
 * already caught real production bugs.
 */
function requireClerkKeys(): void {
  const missing = ['CLERK_SECRET_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'].filter(
    (name) => !process.env[name],
  );
  if (!missing.length) return;
  throw new Error(
    `Missing ${missing.join(' and ')}. Identity lives in Clerk, so these tests need a real ` +
      'Clerk dev instance. Locally they are read from apps/web/.env.local; in CI they must be ' +
      'set as the repository secrets CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY ' +
      '(Settings > Secrets and variables > Actions).',
  );
}

requireClerkKeys();

export const WEB_PORT = 3100;
export const API_PORT = 8110;
export const baseURL = `http://127.0.0.1:${WEB_PORT}`;
export const apiURL = `http://127.0.0.1:${API_PORT}`;

export const backendEnv = {
  APP_ENV: 'test',
  APP_SECRET_KEY: 'e2e-canonical-journey-test-secret-key-not-for-prod',
  SENSITIVE_DATA_ENCRYPTION_KEY: 'OFFhoDNc-nQniH2K21fY9c5PkG8QwAyxpH8V4dV0N-Y=',
  DATABASE_URL: `sqlite:///${dbPath.replace(/\\/g, '/')}`,
  FRONTEND_URL: baseURL,
  AUTO_CREATE_TABLES: 'false',
  // The backend verifies Clerk's session tokens, so it needs the same
  // instance the browser signs into.
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ?? '',
};
