/**
 * Talks to Kall.
 *
 * Calls the backend's public API directly -- the same path the mobile app
 * uses (docs/AWS_DEPLOYMENT.md's "Public API path"), not the web app's
 * `/api/kall/[...path]` proxy. That proxy exists to mint a backend token
 * from the browser's own Clerk session cookie, but that cookie is
 * SameSite=Lax and a fetch from the extension's own chrome-extension://
 * origin is cross-site by definition -- the browser never attached it, so
 * the popup always looked signed out no matter what the web app showed.
 *
 * auth.js's synced Clerk session solves that at the source: it gives the
 * extension its own bearer token, kept in step with the web app's session,
 * which travels in an Authorization header rather than depending on any
 * cookie policy at all.
 */

import { origin } from './config.js';

/**
 * Where this module gets a bearer token, and Kall's origin. Deliberately
 * NOT a static import of auth.js: auth.js pulls in @clerk/chrome-extension,
 * which throws at import time outside a real browser extension context
 * (it detects the environment eagerly, not lazily) -- so this file could
 * never be imported in a plain Node test if it imported that chain itself,
 * even without ever calling anything from it.
 *
 * popup.js -- the only place that needs both api.js and auth.js -- wires
 * the real getSessionToken into `deps` once at startup, below. A test wires
 * in a fake instead, and never touches auth.js or Clerk at all.
 */
export const deps = {
  getSessionToken: null,
  origin,
};

/** Signed-out and network failures are different problems; keep them apart. */
export class NotSignedInError extends Error {
  constructor() {
    super('Sign in to Kall, then try again.');
    this.name = 'NotSignedInError';
  }
}

async function authorizedHeaders(extra = {}) {
  if (!deps.getSessionToken) {
    throw new Error('api.js: deps.getSessionToken was never configured. See popup.js.');
  }
  const token = await deps.getSessionToken();
  if (!token) throw new NotSignedInError();
  return { Authorization: `Bearer ${token}`, ...extra };
}

async function request(path, init = {}) {
  const headers = await authorizedHeaders({ Accept: 'application/json', ...(init.headers || {}) });
  const response = await fetch(`${await deps.origin()}/api${path}`, { ...init, headers });
  if (response.status === 401) throw new NotSignedInError();
  if (!response.ok) throw new Error(`Kall returned ${response.status}.`);
  return response.json();
}

/** Applications that are ready to be filled somewhere. */
export async function listApplications() {
  return request('/applications');
}

/** Everything Kall is willing to put into this application's form. */
export async function autofillPack(applicationId) {
  return request(`/applications/${applicationId}/autofill-pack`);
}

/**
 * The resume bytes, as a data URL.
 *
 * Content scripts cannot fetch from Kall's origin (they run on the employer's
 * origin, and this extension's bearer token is not theirs to send), and
 * chrome.runtime messages must be JSON-serializable -- so the bytes are
 * fetched here and handed over encoded rather than as a Blob.
 */
export async function resumeDataUrl(downloadPath) {
  const headers = await authorizedHeaders();
  const response = await fetch(`${await deps.origin()}${downloadPath}`, { headers });
  if (response.status === 401) throw new NotSignedInError();
  if (!response.ok) throw new Error(`Could not download the resume (${response.status}).`);

  const blob = await response.blob();
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { dataUrl, type: blob.type };
}
