'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { clearPendingPosting, getPendingPosting, hideSearchResult, isSearchResultHidden, setPendingPosting } from '../lib/searchResultState';
import { showToast } from './ToastHost';

const GOOGLE_CSE_ID = '551e53ca5b28b4060';
const SCRIPT_ID = 'kall-google-cse-script';
const API = '/api/kall';

type SearchElement = { execute: (query: string) => void; clearAllResults?: () => void };
type GoogleCseApi = {
  render: (config: { div: HTMLElement; tag: 'searchresults-only'; gname: string; attributes: Record<string, string | boolean> }) => void;
  getElement: (gname: string) => SearchElement | null;
};

declare global {
  interface Window {
    __gcse?: { parsetags: 'explicit' };
    google?: { search?: { cse?: { element?: GoogleCseApi } } };
    __kallGoogleCsePromise?: Promise<void>;
  }
}

function loadGoogleCse() {
  if (window.google?.search?.cse?.element) return Promise.resolve();
  if (window.__kallGoogleCsePromise) return window.__kallGoogleCsePromise;
  window.__gcse = { parsetags: 'explicit' };
  window.__kallGoogleCsePromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const finish = () => {
      let attempts = 0;
      const waitForApi = window.setInterval(() => {
        attempts += 1;
        if (window.google?.search?.cse?.element) { window.clearInterval(waitForApi); resolve(); }
        else if (attempts > 100) { window.clearInterval(waitForApi); reject(new Error('Google job search did not finish loading.')); }
      }, 50);
    };
    if (existing) { finish(); return; }
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = `https://cse.google.com/cse.js?cx=${GOOGLE_CSE_ID}`;
    script.onload = finish;
    script.onerror = () => reject(new Error('Google job search could not be loaded.'));
    document.head.appendChild(script);
  });
  return window.__kallGoogleCsePromise;
}

async function trackExternalApplication(posting: { url: string; title: string; snippet: string; profileId?: string }) {
  const token = localStorage.getItem('kall_token');
  if (!token) { window.location.replace('/login'); return false; }
  if (!posting.profileId) {
    showToast('Select a professional profile before marking this job as applied.', 'error');
    return false;
  }
  const response = await fetch(`${API}/applications/track-external`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: posting.url,
      title: posting.title,
      snippet: posting.snippet,
      professional_profile_id: Number(posting.profileId),
      source: 'google_cse',
    }),
  });
  if (response.status === 401) { localStorage.removeItem('kall_token'); window.location.replace('/login'); return false; }
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

function decorateResults(container: HTMLElement, profileId?: string) {
  const pending = getPendingPosting();
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

      const apply = document.createElement('a');
      apply.className = 'button kall-result-apply';
      apply.textContent = 'Apply with Kall';
      const params = new URLSearchParams({ external_url: titleLink.href, title, snippet });
      if (profileId) params.set('profile', profileId);
      apply.href = `/applications/new?${params.toString()}`;

      const view = document.createElement('a');
      view.className = 'button secondary';
      view.textContent = 'View posting';
      view.href = titleLink.href;
      view.target = '_blank';
      view.rel = 'noreferrer';
      view.onclick = () => setPendingPosting(posting);

      actions.append(apply, view);
      result.appendChild(actions);
    }

    if (pending && pending.url === titleLink.href) addAppliedPrompt(result, { ...pending, profileId: pending.profileId || profileId });
  });
}

export default function GoogleJobSearchResults({ query, profileId }: { query: string; profileId?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reactId = useId().replace(/:/g, '');
  const elementName = `kall-job-results-${reactId}`;
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let observer: MutationObserver | null = null;
    if (!query || !containerRef.current) return;

    const refreshDecorations = () => { if (containerRef.current) decorateResults(containerRef.current, profileId); };
    const onFocus = () => refreshDecorations();
    const onChanged = () => refreshDecorations();
    window.addEventListener('focus', onFocus);
    window.addEventListener('kall:search-results-changed', onChanged);

    async function renderResults() {
      try {
        await loadGoogleCse();
        if (cancelled || !containerRef.current) return;
        containerRef.current.replaceChildren();
        const api = window.google?.search?.cse?.element;
        if (!api) throw new Error('Google job search is unavailable.');
        api.render({ div: containerRef.current, tag: 'searchresults-only', gname: elementName, attributes: { autoSearchOnLoad: false, linkTarget: '_blank', enableImageSearch: false } });
        observer = new MutationObserver(refreshDecorations);
        observer.observe(containerRef.current, { childList: true, subtree: true });
        const element = api.getElement(elementName);
        if (!element) throw new Error('Google job results could not be initialized.');
        element.execute(query);
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
  }, [elementName, profileId, query]);

  return <div className="google-job-search" aria-live="polite">{error && <p className="notice" role="alert">{error}</p>}<div ref={containerRef} className="google-job-search-results" /></div>;
}
