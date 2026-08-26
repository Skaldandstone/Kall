/**
 * Talks to Kall.
 *
 * The extension deliberately holds no credential of its own. Every request
 * goes to Kall's own origin with `credentials: 'include'`, so the browser
 * attaches Clerk's httpOnly session cookie and the /api/kall proxy mints the
 * backend token server-side -- exactly what the web app does.
 *
 * That is worth being explicit about, because the obvious alternative is to
 * store an API token in extension storage. Extension storage is readable by
 * anything that compromises the extension, and this account holds EEO and
 * work-authorization data. Holding nothing is the stronger position: revoking
 * the Kall session revokes the extension with it, and there is no token to
 * scope, rotate, or leak.
 */

const DEFAULT_ORIGIN = 'https://d7wb2yokfqcku.cloudfront.net';

/** Signed-out and network failures are different problems; keep them apart. */
export class NotSignedInError extends Error {
  constructor() {
    super('Sign in to Kall in your browser, then try again.');
    this.name = 'NotSignedInError';
  }
}

export async function origin() {
  const stored = await chrome.storage.sync.get('origin');
  return stored.origin || DEFAULT_ORIGIN;
}

async function request(path, init = {}) {
  const response = await fetch(`${await origin()}/api/kall${path}`, {
    ...init,
    credentials: 'include',
    headers: { Accept: 'application/json', ...(init.headers || {}) },
  });
  // The proxy 404s rather than 401s an unauthenticated call (its middleware
  // treats the route as non-public), so treat both as "not signed in" rather
  // than reporting a confusing "not found" for a path that plainly exists.
  if (response.status === 401 || response.status === 404) throw new NotSignedInError();
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
 * origin, and Kall's cookie is not theirs to send), and chrome.runtime
 * messages must be JSON-serializable -- so the bytes are fetched here and
 * handed over encoded rather than as a Blob.
 */
export async function resumeDataUrl(downloadPath) {
  const response = await fetch(`${await origin()}${downloadPath.replace(/^\/api/, '/api/kall')}`, {
    credentials: 'include',
  });
  if (response.status === 401 || response.status === 404) throw new NotSignedInError();
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
