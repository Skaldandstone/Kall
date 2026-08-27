export type SuppressionReason = 'dead_link' | 'applied_external' | 'applied_kall';

export type HiddenSearchResult = {
  url: string;
  title?: string;
  reason: SuppressionReason;
  suppressed_at: string;
};

declare global {
  interface WindowEventMap {
    'kall:search-results-changed': CustomEvent<void>;
  }
}

const API = '/api/kall';
const PENDING_KEY = 'kall_pending_posting';

/**
 * Suppressions live on the server (see backend/kall/models/discovery.py), not
 * in localStorage: the whole point of flagging a dead link is that it stays
 * flagged on another device and, more importantly, that the scheduled
 * discovery run keeps it out of the daily brief -- and that run has no browser
 * to read localStorage from.
 *
 * The Google CSE results are decorated synchronously as its widget mutates the
 * DOM, so the list is mirrored in a module-level cache and read from there.
 * Hydration fires 'kall:search-results-changed', which the search screens
 * already listen for, so a late-arriving list re-filters what is on screen.
 */
let cache: HiddenSearchResult[] = [];
let keys = new Set<string>();
let hydration: Promise<void> | null = null;

function normalize(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.host = parsed.host.toLowerCase();
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

/**
 * Both spellings a suppression should cover. Mirrors match_keys() in
 * backend/kall/services/suppression.py -- ATS postings are stored with their
 * query string stripped, so a link flagged with one would otherwise not match
 * the same posting arriving without one.
 */
function matchKeys(url: string) {
  const normalized = normalize(url);
  return [normalized, normalized.split('?')[0]];
}

function reindex() {
  keys = new Set(cache.flatMap((item) => matchKeys(item.url)));
  window.dispatchEvent(new CustomEvent<void>('kall:search-results-changed'));
}

/** Hydrate the cache once per page. Safe to call from several components. */
export function loadSuppressedResults(): Promise<void> {
  if (hydration) return hydration;
  hydration = (async () => {
    const response = await fetch(`${API}/search/suppressed`);
    if (response.status === 401) { window.location.replace('/sign-in'); return; }
    if (!response.ok) return;
    cache = await response.json();
    reindex();
  })().catch(() => {
    // A failed hydration must not blank the results column -- showing a
    // posting that should have been hidden is the mild failure here.
    hydration = null;
  });
  return hydration;
}

export function getHiddenSearchResults(): HiddenSearchResult[] {
  return cache;
}

export function isSearchResultHidden(url: string) {
  return matchKeys(url).some((key) => keys.has(key));
}

export function hideSearchResult(url: string, title: string | undefined, reason: SuppressionReason) {
  const normalized = normalize(url);
  // Update the cache first so the result disappears on this click rather than
  // after the round trip; the request below is what makes it durable.
  cache = [
    ...cache.filter((item) => normalize(item.url) !== normalized),
    { url: normalized, title, reason, suppressed_at: new Date().toISOString() },
  ];
  reindex();
  void fetch(`${API}/search/suppressed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: normalized, title, reason }),
  });
}

export function restoreSearchResult(url: string) {
  const normalized = normalize(url);
  cache = cache.filter((item) => normalize(item.url) !== normalized);
  reindex();
  void fetch(`${API}/search/suppressed`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: normalized }),
  });
}

export function restoreHiddenSearchResults() {
  cache = [];
  reindex();
  void fetch(`${API}/search/suppressed/all`, { method: 'DELETE' });
}

export function hiddenSearchResultCount() {
  return cache.length;
}

export function deadLinkCount() {
  return cache.filter((item) => item.reason === 'dead_link').length;
}

export type PendingPosting = { url: string; title: string; snippet: string; profileId?: string };

// Deliberately still sessionStorage: this is "the tab the user just opened a
// posting from", which is per-tab and should not outlive it.
export function setPendingPosting(posting: PendingPosting) {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(posting));
}

export function getPendingPosting(): PendingPosting | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
    return value && typeof value.url === 'string' ? value : null;
  } catch {
    return null;
  }
}

export function clearPendingPosting() {
  sessionStorage.removeItem(PENDING_KEY);
}
