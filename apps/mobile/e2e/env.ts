import path from 'node:path';

export const repoRoot = path.resolve(__dirname, '..', '..', '..');
export const dbPath = path.join(repoRoot, 'e2e-mobile.db');

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
};
