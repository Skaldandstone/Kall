'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { clearPendingPosting, getPendingPosting, hideSearchResult, isSearchResultHidden, loadSuppressedResults, setPendingPosting } from '../lib/searchResultState';
import { loadGoogleCse, type SearchElement } from '../lib/googleCse';
import { showToast } from './ToastHost';

const GOOGLE_CSE_ID = '551e53ca5b28b4060';
const API = '/api/kall';

async function trackExternalApplication(posting: { url: string; title: string; snippet: string; profileId?: string }) {
  if (!posting.profileId) {
    showToast('Select a professional profile before marking this job as applied.', 'error');
    return false;
  }
  // An application already under way in Kall for this link should be
  // finished there, not silently closed as applied; ask first.
  let markSubmittedAnyway = false;
  const check = await fetch(`${API}/me/applications/existing?url=${encodeURIComponent(posting.url)}`).catch(() => null);
  if (check?.ok) {
    const { application: existing } = await check.json() as { application: { id: number; stage: string; completed: boolean } | null };
    if (existing && !existing.completed) {
      const finishInKall = window.confirm(`You already started this application in Kall (${existing.stage.replace(/_/g, ' ')}).

OK opens it so you can finish it. Cancel records it as applied anyway.`);
      if (finishInKall) { window.location.assign(`/applications/${existing.id}`); return false; }
      markSubmittedAnyway = true;
    }
  }
  const response = await fetch(`${API}/applications/track-external`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: posting.url,
      title: posting.title,
      snippet: posting.snippet,
      professional_profile_id: Number(posting.profileId),
      source: 'google_cse',
      mark_submitted_anyway: markSubmittedAnyway,
    }),
  });
  if (response.status === 401) {window.location.replace('/sign-in'); return false; }
  if (!response.ok) {
    let message = 'Unable to track that application.';
    try { const data = await response.json(); if (typeof data.detail === 'string') message = data.detail; } catch { /* keep fallback */ }
    showToast(message, 'error');
    return false;
  }
  hideSearchResult(posting.url, posting.title, 'applied_external');
  clearPendingPosting();
  showToast('Application added to your Kall pipeline.', 'success');
  return true;
}

async function trackConsultingLead(posting: { url: string; title: string; snippet: string }) {
  let organization = 'Public opportunity';
  try { organization = new URL(posting.url).hostname.replace(/^www\./, ''); } catch { /* keep fallback */ }
  const response = await fetch(`${API}/me/consulting/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      organization,
      opportunity_name: posting.title,
      relationship_segment: 'marketplace',
      source: 'Kall public lead finder',
      source_url: posting.url,
      next_step: 'Verify the business problem, decision maker, timeline, budget, and fit.',
      notes: posting.snippet || null,
    }),
  });
  if (response.status === 401) { window.location.replace('/sign-in'); return false; }
  if (!response.ok) {
    let message = 'Unable to track that consulting lead.';
    try { const data = await response.json(); if (typeof data.detail === 'string') message = data.detail; } catch { /* keep fallback */ }
    showToast(message, 'error');
    return false;
  }
  showToast('Consulting lead added to your private pipeline.', 'success');
  return true;
}

function addAppliedPrompt(result: HTMLElement, posting: { url: string; title: string; snippet: string; profileId?: string }) {
  const actions = result.querySelector<HTMLElement>('.kall-search-result-actions');
  if (!actions || actions.querySelector('.kall-applied-prompt')) return;
  const prompt = document.createElement('div');
  prompt.className = 'kall-applied-prompt';
  const label = document.createElement('span');
  label.textContent = 'Did you apply?';
  const yes = document.createElement('button');
  yes.type = 'button'; yes.className = 'button'; yes.textContent = 'Yes';
  const no = document.createElement('button');
  no.type = 'button'; no.className = 'button secondary'; no.textContent = 'No';
  no.onclick = () => { prompt.remove(); clearPendingPosting(); };
  yes.onclick = async () => {
    yes.disabled = true; no.disabled = true;
    if (await trackExternalApplication(posting)) result.remove();
    else { yes.disabled = false; no.disabled = false; }
  };
  prompt.append(label, yes, no);
  actions.appendChild(prompt);
}

function decorateResults(container: HTMLElement, profileId?: string, mode: 'jobs' | 'consulting' = 'jobs') {
  const pending = mode === 'jobs' ? getPendingPosting() : null;
  container.querySelectorAll<HTMLElement>('.gsc-webResult.gsc-result').forEach((result) => {
    const titleLink = result.querySelector<HTMLAnchorElement>('.gs-title a');
    if (!titleLink?.href) return;
    if (isSearchResultHidden(titleLink.href)) { result.remove(); return; }

    const title = titleLink.textContent?.trim() || 'Imported job opportunity';
    const snippet = result.querySelector<HTMLElement>('.gs-snippet')?.textContent?.trim() || '';
    const posting = { url: titleLink.href, title, snippet, profileId };

    if (result.dataset.kallActions !== 'true') {
      result.dataset.kallActions = 'true';
      const actions = document.createElement('div');
      actions.className = 'kall-search-result-actions';

      const primary = mode === 'consulting'
        ? document.createElement('button')
        : document.createElement('a');
      primary.className = 'button kall-result-apply';
      if (mode === 'consulting') {
        primary.textContent = 'Track consulting lead';
        (primary as HTMLButtonElement).type = 'button';
        primary.onclick = async () => {
          (primary as HTMLButtonElement).disabled = true;
          if (await trackConsultingLead(posting)) result.remove();
          else (primary as HTMLButtonElement).disabled = false;
        };
      } else {
        primary.textContent = 'Apply with Kall';
        const params = new URLSearchParams({ external_url: titleLink.href, title, snippet });
        if (profileId) params.set('profile', profileId);
        (primary as HTMLAnchorElement).href = `/applications/new?${params.toString()}`;
      }

      const view = document.createElement('a');
      view.className = 'button secondary';
      view.textContent = 'View posting';
      view.href = titleLink.href;
      view.target = '_blank';
      view.rel = 'noreferrer';
      if (mode === 'jobs') view.onclick = () => setPendingPosting(posting);

      // Dead links are the single biggest source of noise in these results:
      // boards keep serving a page long after the role is filled. Flagging one
      // is server-side, so it also keeps the posting out of the daily brief.
      const dead = document.createElement('button');
      dead.type = 'button';
      dead.className = 'button ghost kall-result-dead';
      dead.textContent = 'Dead link';
      dead.title = 'Hide this posting and keep it out of future searches';
      dead.onclick = () => {
        hideSearchResult(posting.url, posting.title, 'dead_link');
        result.remove();
        showToast('Flagged as a dead link. Undo from "Restore hidden results".', 'success');
      };

      actions.append(primary, view, dead);
      result.appendChild(actions);
    }

    if (pending && pending.url === titleLink.href) addAppliedPrompt(result, { ...pending, profileId: pending.profileId || profileId });
  });
}

export type SiteQuery = { provider: string; domain: string; query: string };

/** A single query, wrapped as the one-item queue GoogleJobSearchResults expects. */
export function soloQuery(query: string): SiteQuery[] {
  return query ? [{ provider: '', domain: '', query }] : [];
}

export default function GoogleJobSearchResults({ queries, profileId, mode = 'jobs' }: { queries: SiteQuery[]; profileId?: string; mode?: 'jobs' | 'consulting' }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reactId = useId().replace(/:/g, '');
  const elementName = `kall-job-results-${reactId}`;
  const [error, setError] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  // One CSE widget, re-executed per page -- 39 sites means 39 mounts would be
  // wasteful and, worse, would each re-run loadGoogleCse's global script load.
  const elementRef = useRef<SearchElement | null>(null);

  // A brand-new search (not just paging through the current one) starts over.
  useEffect(() => { setPageIndex(0); }, [queries]);

  useEffect(() => {
    let cancelled = false;
    let observer: MutationObserver | null = null;
    const current = queries[pageIndex];
    if (!current || !containerRef.current) return;

    const refreshDecorations = () => { if (containerRef.current) decorateResults(containerRef.current, profileId, mode); };
    const onFocus = () => refreshDecorations();
    const onChanged = () => refreshDecorations();
    window.addEventListener('focus', onFocus);
    window.addEventListener('kall:search-results-changed', onChanged);

    async function renderResults() {
      try {
        await Promise.all([loadGoogleCse(GOOGLE_CSE_ID), loadSuppressedResults()]);
        if (cancelled || !containerRef.current) return;
        let element = elementRef.current;
        if (!element) {
          containerRef.current.replaceChildren();
          const api = window.google?.search?.cse?.element;
          if (!api) throw new Error('Google job search is unavailable.');
          api.render({ div: containerRef.current, tag: 'searchresults-only', gname: elementName, attributes: { autoSearchOnLoad: false, linkTarget: '_blank', enableImageSearch: false } });
          observer = new MutationObserver(refreshDecorations);
          observer.observe(containerRef.current, { childList: true, subtree: true });
          element = api.getElement(elementName);
          elementRef.current = element;
        }
        if (!element) throw new Error('Google job results could not be initialized.');
        element.execute(current.query);
        setError('');
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Unable to display job results.');
      }
    }
    void renderResults();
    return () => {
      cancelled = true;
      observer?.disconnect();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('kall:search-results-changed', onChanged);
    };
  }, [elementName, mode, profileId, queries, pageIndex]);

  const current = queries[pageIndex];

  return (
    <div className="google-job-search" aria-live="polite">
      {queries.length > 1 && current && (
        <div className="google-job-search-pager">
          <button
            type="button"
            className="button secondary"
            onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
            disabled={pageIndex === 0}
          >
            Previous site
          </button>
          <span className="muted">
            {current.provider ? `${current.provider} (${current.domain}) — ` : ''}
            site {pageIndex + 1} of {queries.length}
          </span>
          <button
            type="button"
            className="button secondary"
            onClick={() => setPageIndex((index) => Math.min(queries.length - 1, index + 1))}
            disabled={pageIndex === queries.length - 1}
          >
            Next site
          </button>
        </div>
      )}
      {error && <p className="notice" role="alert">{error}</p>}
      <div ref={containerRef} className="google-job-search-results" />
    </div>
  );
}
