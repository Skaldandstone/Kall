/**
 * Where Kall is. Shared by api.js and auth.js so there is exactly one
 * origin the extension ever talks to -- api.js's requests and auth.js's
 * Clerk sync host would silently disagree if each kept its own copy.
 */

const DEFAULT_ORIGIN = 'https://d7wb2yokfqcku.cloudfront.net';

export async function origin() {
  const stored = await chrome.storage.sync.get('origin');
  return stored.origin || DEFAULT_ORIGIN;
}
