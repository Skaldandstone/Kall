/**
 * Identity for the extension, synced from the Kall web app rather than held
 * separately.
 *
 * The extension used to hold no credential at all -- it rode the browser's
 * own Clerk session cookie via `fetch(credentials: 'include')`. That broke
 * silently: Clerk's session cookie is SameSite=Lax, which browsers only
 * attach on same-site requests and top-level navigations. A fetch from the
 * extension's popup (its own chrome-extension:// origin) is a cross-site
 * request by definition, so the cookie was never sent -- someone fully
 * signed in on kall's own site would still see "sign in to Kall" from the
 * popup, forever, because the popup could never prove it.
 *
 * Clerk's Chrome Extension SDK exists specifically for this: "Sync Host"
 * gives the extension its own session, kept in step with the web app's,
 * without touching that cookie at all. https://clerk.com/docs/guides/sessions/sync-host
 *
 * The web app's Clerk instance must list this extension's origin under
 * Allowed Origins, or the sync silently does nothing -- see
 * docs/EXTENSION_CLERK_SETUP.md for the one-time setup this needs.
 */

import { createClerkClient } from '@clerk/chrome-extension/client';
import { origin } from './config.js';

let clerkPromise = null;

/** The Clerk client, loaded once and reused. Resolves once sync has settled. */
export async function getClerk() {
  if (!clerkPromise) {
    clerkPromise = (async () => {
      const stored = await chrome.storage.sync.get('publishableKey');
      const publishableKey = stored.publishableKey || DEFAULT_PUBLISHABLE_KEY;
      const syncHost = await origin();
      const clerk = createClerkClient({ publishableKey, syncHost });
      await clerk.load({ allowedRedirectProtocols: ['chrome-extension:'] });
      return clerk;
    })();
  }
  return clerkPromise;
}

/**
 * The current session's bearer token, or null if nobody is signed in.
 *
 * A fresh token each call -- Clerk's client caches and refreshes the
 * underlying JWT itself, so this is cheap, and it means a token is never
 * held past the moment it is used.
 */
export async function getSessionToken() {
  const clerk = await getClerk();
  if (!clerk.session) return null;
  return clerk.session.getToken();
}

/**
 * Re-render whenever sign-in state changes -- most importantly, the moment
 * a sync completes after the user finished signing in on the web app in a
 * different tab. Without this the popup would need an explicit "I've signed
 * in, retry" button; with it, the popup catches up on its own.
 */
export async function onAuthChange(callback) {
  const clerk = await getClerk();
  clerk.addListener(callback);
}

/** Opens Kall's real sign-in page. The popup does not embed Clerk's UI
 * itself -- there is not enough room in a 360px-wide popup to do that
 * justice, and the web app's own page already handles every sign-in method
 * Clerk is configured with. */
export async function openSignIn() {
  const base = await origin();
  await chrome.tabs.create({ url: `${base}/sign-in` });
}

// Public by design -- it only names which Clerk instance to talk to, the
// same way a project id or client id is public. Overridable via
// chrome.storage.sync for pointing a dev build at a different instance.
const DEFAULT_PUBLISHABLE_KEY = 'pk_test_Y2hhcm1pbmctbW9jY2FzaW4tODc0OC5jbGVyay5hY2NvdW50cy5kZXYk';
