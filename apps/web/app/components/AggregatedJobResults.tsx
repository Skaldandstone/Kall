'use client';

import { useEffect, useMemo, useState } from 'react';
import { showToast } from './ToastHost';
import {
  clearPendingPosting,
  getPendingPosting,
  hideSearchResult,
  isSearchResultHidden,
  loadSuppressedResults,
  setPendingPosting,
} from '../lib/searchResultState';

const API = '/api/kall';

export type JobResult = { title: string; url: string; snippet: string; provider: string; domain: string };

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
      source: 'google_custom_search',
      mark_submitted_anyway: markSubmittedAnyway,
    }),
  });
  if (response.status === 401) { window.location.replace('/sign-in'); return false; }
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

function ResultCard({ result, profileId, onHide }: { result: JobResult; profileId?: string; onHide: (url: string) => void }) {
  const [showAppliedPrompt, setShowAppliedPrompt] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const checkPending = () => {
      const pending = getPendingPosting();
      setShowAppliedPrompt(!!pending && pending.url === result.url);
    };
    checkPending();
    window.addEventListener('focus', checkPending);
    return () => window.removeEventListener('focus', checkPending);
  }, [result.url]);

  const applyParams = new URLSearchParams({ external_url: result.url, title: result.title, snippet: result.snippet });
  if (profileId) applyParams.set('profile', profileId);

  return (
    <article className="kall-search-result gsc-webResult gsc-result">
      <div className="gs-title"><a href={result.url} target="_blank" rel="noreferrer">{result.title}</a></div>
      <div className="gs-visibleUrl-long">{result.provider} &middot; {result.domain}</div>
      <div className="gs-snippet">{result.snippet}</div>
      <div className="kall-search-result-actions">
        <a className="button kall-result-apply" href={`/applications/new?${applyParams.toString()}`}>Apply with Kall</a>
        <a
          className="button secondary"
          href={result.url}
          target="_blank"
          rel="noreferrer"
          onClick={() => setPendingPosting({ url: result.url, title: result.title, snippet: result.snippet, profileId })}
        >
          View posting
        </a>
        <button
          type="button"
          className="button ghost kall-result-dead"
          title="Hide this posting and keep it out of future searches"
          onClick={() => {
            hideSearchResult(result.url, result.title, 'dead_link');
            onHide(result.url);
            showToast('Flagged as a dead link. Undo from "Restore hidden results".', 'success');
          }}
        >
          Dead link
        </button>
        <button
          type="button"
          className="button ghost"
          title="Wrong kind of role for this search -- stop showing this and similar postings"
          onClick={() => {
            hideSearchResult(result.url, result.title, 'not_relevant');
            onHide(result.url);
            showToast('Marked not relevant. Undo from "Restore hidden results".', 'success');
          }}
        >
          Not relevant
        </button>
        <button
          type="button"
          className="button ghost"
          title="Hide this one result -- it may still resurface if it changes"
          onClick={() => {
            hideSearchResult(result.url, result.title, 'hidden');
            onHide(result.url);
            showToast('Hidden. Undo from "Restore hidden results".', 'success');
          }}
        >
          Hide
        </button>
      </div>
      {showAppliedPrompt && (
        <div className="kall-applied-prompt">
          <span>Did you apply?</span>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await trackExternalApplication({ ...result, profileId });
              setBusy(false);
              if (ok) onHide(result.url);
              else setShowAppliedPrompt(false);
            }}
          >
            Yes
          </button>
          <button type="button" className="button secondary" onClick={() => { setShowAppliedPrompt(false); clearPendingPosting(); }}>
            No
          </button>
        </div>
      )}
    </article>
  );
}

export default function AggregatedJobResults({ results, profileId, sitesSearched, sitesFailed }: {
  results: JobResult[];
  profileId?: string;
  sitesSearched: number;
  sitesFailed: number;
}) {
  const [hiddenUrls, setHiddenUrls] = useState<Set<string>>(new Set());

  useEffect(() => {
    const refresh = () => setHiddenUrls(new Set(results.filter((result) => isSearchResultHidden(result.url)).map((result) => result.url)));
    void loadSuppressedResults().then(refresh);
    window.addEventListener('kall:search-results-changed', refresh);
    return () => window.removeEventListener('kall:search-results-changed', refresh);
  }, [results]);

  const visible = useMemo(() => results.filter((result) => !hiddenUrls.has(result.url)), [results, hiddenUrls]);

  return (
    <div className="google-job-search" aria-live="polite">
      <p className="muted" style={{ marginBottom: 12 }}>
        {visible.length} result{visible.length === 1 ? '' : 's'} across {sitesSearched} site{sitesSearched === 1 ? '' : 's'}
        {sitesFailed > 0 ? ` (${sitesFailed} could not be searched)` : ''}
      </p>
      <div className="google-job-search-results">
        {visible.map((result) => (
          <ResultCard key={result.url} result={result} profileId={profileId} onHide={(url) => setHiddenUrls((prev) => new Set(prev).add(url))} />
        ))}
        {!visible.length && <p className="muted">No results yet. Try broadening your search terms.</p>}
      </div>
    </div>
  );
}
