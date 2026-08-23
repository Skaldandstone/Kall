'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { loadGoogleCse } from '../lib/googleCse';
import { showToast } from './ToastHost';

const GOOGLE_CSE_ID = '551e53ca5b28b4060';
const API = '/api/kall';

async function saveResource(planId: number, posting: { url: string; title: string; snippet: string }) {
  const token = localStorage.getItem('kall_token');
  if (!token) {
    window.location.replace('/login');
    return false;
  }
  const response = await fetch(`${API}/growth/plans/${planId}/resources`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: posting.url, title: posting.title, description: posting.snippet || null }),
  });
  if (response.status === 401) {
    localStorage.removeItem('kall_token');
    window.location.replace('/login');
    return false;
  }
  if (!response.ok) {
    let message = 'Unable to save that resource.';
    try {
      const data = await response.json();
      if (typeof data.detail === 'string') message = data.detail;
    } catch {
      // keep fallback message
    }
    showToast(message, 'error');
    return false;
  }
  showToast('Resource saved to your plan.', 'success');
  return true;
}

function decorateResults(container: HTMLElement, planId: number, savedUrls: Set<string>, onSaved: () => void) {
  container.querySelectorAll<HTMLElement>('.gsc-webResult.gsc-result').forEach((result) => {
    const titleLink = result.querySelector<HTMLAnchorElement>('.gs-title a');
    if (!titleLink?.href) return;
    const title = titleLink.textContent?.trim() || 'Learning resource';
    const snippet = result.querySelector<HTMLElement>('.gs-snippet')?.textContent?.trim() || '';
    const posting = { url: titleLink.href, title, snippet };

    if (result.dataset.kallResourceAction === 'true') return;
    result.dataset.kallResourceAction = 'true';

    const actions = document.createElement('div');
    actions.className = 'kall-search-result-actions';

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'button';
    save.textContent = savedUrls.has(posting.url) ? 'Saved' : 'Save to plan';
    save.disabled = savedUrls.has(posting.url);
    save.onclick = async () => {
      save.disabled = true;
      save.textContent = 'Saving…';
      const ok = await saveResource(planId, posting);
      if (ok) {
        savedUrls.add(posting.url);
        save.textContent = 'Saved';
        onSaved();
      } else {
        save.disabled = false;
        save.textContent = 'Save to plan';
      }
    };

    const view = document.createElement('a');
    view.className = 'button secondary';
    view.textContent = 'View';
    view.href = titleLink.href;
    view.target = '_blank';
    view.rel = 'noreferrer';

    actions.append(save, view);
    result.appendChild(actions);
  });
}

export default function GoogleResourceSearchResults({ query, planId, onSaved }: { query: string; planId: number; onSaved: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reactId = useId().replace(/:/g, '');
  const elementName = `kall-resource-results-${reactId}`;
  const [error, setError] = useState('');
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  useEffect(() => {
    let cancelled = false;
    let observer: MutationObserver | null = null;
    const savedUrls = new Set<string>();
    if (!query || !containerRef.current) return;

    async function renderResults() {
      try {
        await loadGoogleCse(GOOGLE_CSE_ID);
        if (cancelled || !containerRef.current) return;
        containerRef.current.replaceChildren();
        const api = window.google?.search?.cse?.element;
        if (!api) throw new Error('Resource search is unavailable.');
        api.render({ div: containerRef.current, tag: 'searchresults-only', gname: elementName, attributes: { autoSearchOnLoad: false, linkTarget: '_blank', enableImageSearch: false } });
        const refresh = () => { if (containerRef.current) decorateResults(containerRef.current, planId, savedUrls, () => onSavedRef.current()); };
        observer = new MutationObserver(refresh);
        observer.observe(containerRef.current, { childList: true, subtree: true });
        const element = api.getElement(elementName);
        if (!element) throw new Error('Resource search could not be initialized.');
        element.execute(query);
        setError('');
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Unable to display resource results.');
      }
    }
    void renderResults();
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [elementName, planId, query]);

  return (
    <div className="google-job-search" aria-live="polite">
      {error && <p className="notice" role="alert">{error}</p>}
      <div ref={containerRef} className="google-job-search-results" />
    </div>
  );
}
