import fs from 'node:fs';
import path from 'node:path';

export const repoRoot = path.resolve(__dirname, '..', '..', '..');
export const mobileRoot = path.resolve(__dirname, '..');
export const webRoot = path.join(repoRoot, 'apps', 'web');
export const dbPath = path.join(repoRoot, 'e2e-mobile.db');

/**
 * The Playwright process gets no dotenv treatment of its own, but global
 * setup, the Clerk testing token, and the backend all need the Clerk keys.
 *
 * Web and mobile sign into the *same* Clerk dev instance, and the keys have
 * only ever been kept in apps/web/.env.local, so fall back to that rather
 * than making every developer copy them into a second file. A mobile-local
 * .env still wins if one exists. Anything already in the real environment
 * wins over both, so CI secrets are never overwritten.
 */
function loadEnvFiles(): void {
  const candidates = [path.join(mobileRoot, '.env'), path.join(webRoot, '.env.local')];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.trim().replace(/^["']|["']$/g, '');
    }
  }
  // Expo reads its own prefix. Web's file only defines the Next.js one, and
  // both hold the same publishable key for the same instance.
  if (!process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    const shared =
      process.env.CLERK_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    if (shared) process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = shared;
  }
}

loadEnvFiles();

export const WEB_PORT = 8199;
export const API_PORT = 8210;
export const baseURL = `http://127.0.0.1:${WEB_PORT}`;
export const apiURL = `http://127.0.0.1:${API_PORT}`;

export const backendEnv = {
  APP_ENV: 'test',
  APP_SECRET_KEY: 'e2e-mobile-test-secret-key-not-for-prod',
  SENSITIVE_DATA_ENCRYPTION_KEY: 'OFFhoDNc-nQniH2K21fY9c5PkG8QwAyxpH8V4dV0N-Y=',
  DATABASE_URL: `sqlite:///${dbPath.replace(/\\/g, '/')}`,
  FRONTEND_URL: baseURL,
  AUTO_CREATE_TABLES: 'false',
  // The backend verifies Clerk's session tokens, so it needs the same
  // instance the app signs into.
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ?? '',
};
