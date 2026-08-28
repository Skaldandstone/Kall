'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import ProfessionalProfileSelect from '../components/ProfessionalProfileSelect';
import GoogleJobSearchResults from '../components/GoogleJobSearchResults';
import { deadLinkCount, hiddenSearchResultCount, loadSuppressedResults, restoreHiddenSearchResults } from '../lib/searchResultState';
import { showToast } from '../components/ToastHost';

type AtsSearch = { query: string };
type SearchGroup = { id: string; label: string; terms: string[] };

function cleanTerm(value: string) {
  return value.trim().replace(/^site:/i, '').replace(/^['"]|['"]$/g, '').trim();
}

function parseQuery(value: string): SearchGroup[] {
  const groups: SearchGroup[] = [];
  const parenthetical = [...value.matchAll(/\(([^()]+)\)/g)].map((match) => match[1]);
  parenthetical.forEach((content, index) => {
    const terms = [...new Set(content.split(/\s+OR\s+/i).map(cleanTerm).filter(Boolean))];
    if (!terms.length) return;
    const isSites = terms.every((term) => /\.[a-z]{2,}(?:\/|$)/i.test(term));
    const lower = terms.map((term) => term.toLowerCase());
    const isWork = lower.some((term) => ['remote', 'work from home', 'hybrid', 'on site', 'onsite'].includes(term));
    groups.push({ id: `profile-${index}`, label: isSites ? 'Sites' : isWork ? 'Work type' : index === 1 ? 'Job titles' : 'Search terms', terms });
  });
  if (!groups.length && value.trim()) groups.push({ id: 'profile-query', label: 'Search terms', terms: [cleanTerm(value)] });
  return groups;
}

function splitNewTerms(value: string) {
  const terms = value.split(/[,\n]+/).map(cleanTerm).filter(Boolean);
  return terms.length ? terms : value.trim() ? [value.trim()] : [];
}

function buildQuery(groups: SearchGroup[]) {
  return groups.filter((group) => group.terms.length).map((group) => {
    const terms = group.terms.map((term) => group.label === 'Sites' ? `site:${term}` : `"${term.replace(/"/g, '')}"`);
    return terms.length === 1 ? terms[0] : `(${terms.join(' OR ')})`;
  }).join(' ');
}

export default function SearchTab() {
  const [profileId, setProfileId] = useState('');
  const [queryInput, setQueryInput] = useState('');
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [activeQuery, setActiveQuery] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [deadCount, setDeadCount] = useState(0);

  useEffect(() => {
    document.documentElement.classList.add('search-page-active');
    document.body.classList.add('search-page-active');
    const params = new URLSearchParams(window.location.search);
    const selectedProfile = params.get('profile');
    const selectedQuery = params.get('q');
    if (selectedProfile) setProfileId(selectedProfile);
    if (selectedQuery) { const parsed = parseQuery(selectedQuery); setGroups(parsed); setActiveQuery(buildQuery(parsed)); }
    const updateHiddenCount = () => { setHiddenCount(hiddenSearchResultCount()); setDeadCount(deadLinkCount()); };
    updateHiddenCount();
    // The list lives on the server now, so the counts start empty and fill in
    // once it arrives; loadSuppressedResults fires the same change event.
    void loadSuppressedResults();
    window.addEventListener('kall:search-results-changed', updateHiddenCount);
    return () => {
      document.documentElement.classList.remove('search-page-active');
      document.body.classList.remove('search-page-active');
      window.removeEventListener('kall:search-results-changed', updateHiddenCount);
    };
  }, []);

  async function buildProfileQuery(selectedProfile = profileId) {
    if (!selectedProfile) return '';
    const response = await fetch(`/api/kall/discovery/ats-search/${selectedProfile}`);
    if (response.status === 401) {window.location.replace('/sign-in'); return ''; }
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Unable to build a profile search.');
    return (data.queries?.[0] as AtsSearch | undefined)?.query || '';
  }

  async function searchJobs(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    try {
      let nextGroups = groups;
      if (!nextGroups.length && profileId) nextGroups = parseQuery(await buildProfileQuery(profileId));
      const additions = splitNewTerms(queryInput);
      if (additions.length) nextGroups = [...nextGroups, { id: `custom-${Date.now()}`, label: 'Added terms', terms: additions }];
      const finalQuery = buildQuery(nextGroups);
      if (!finalQuery) { showToast('Enter a job title or select a professional profile.', 'error'); return; }
      setGroups(nextGroups);
      setQueryInput('');
      setActiveQuery(finalQuery);
      const url = new URL(window.location.href);
      url.searchParams.set('q', finalQuery);
      if (profileId) url.searchParams.set('profile', profileId); else url.searchParams.delete('profile');
      window.history.replaceState({}, '', url);
      setMessage('Showing Google job results in the results column.');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to start the job search.', 'error');
    } finally { setLoading(false); }
  }

  function removeTerm(groupId: string, term: string) {
    const next = groups.map((group) => group.id === groupId ? { ...group, terms: group.terms.filter((item) => item !== term) } : group).filter((group) => group.terms.length);
    setGroups(next);
    const regenerated = buildQuery(next);
    setActiveQuery(regenerated);
    const url = new URL(window.location.href);
    if (regenerated) url.searchParams.set('q', regenerated); else url.searchParams.delete('q');
    window.history.replaceState({}, '', url);
  }

  function clearResults() {
    setGroups([]); setActiveQuery(''); setQueryInput('');
    const url = new URL(window.location.href); url.searchParams.delete('q'); window.history.replaceState({}, '', url);
    setMessage('Search results cleared.');
  }

  function restoreResults() {
    const currentQuery = activeQuery;
    restoreHiddenSearchResults();
    setHiddenCount(0);
    setDeadCount(0);
    showToast('Hidden results restored, including flagged dead links.', 'success');
    if (currentQuery) {
      setActiveQuery('');
      window.setTimeout(() => setActiveQuery(currentQuery), 0);
    }
  }

  // "Sites" is the built-in ATS-platform-and-job-board list (39 domains and
  // growing) rather than anything the user typed -- rendering 39 individual
  // removable chips for it drowned out the search terms someone actually
  // added. Counted and shown separately, collapsed by default.
  const visibleGroups = groups.filter((group) => group.label !== 'Sites');
  const siteGroup = groups.find((group) => group.label === 'Sites');
  const termCount = useMemo(
    () => visibleGroups.reduce((count, group) => count + group.terms.length, 0),
    [visibleGroups],
  );

  return (
    <section className="search-page-columns" aria-label="Job search workspace">
      <article className="card search-page-controls-column">
        <div className="section-heading search-page-column-heading"><div><span className="eyebrow">Search jobs</span><h2 style={{ marginTop: 14 }}>Build your search</h2></div></div>
        <form className="form" onSubmit={searchJobs}>
          <ProfessionalProfileSelect value={profileId} onChange={(value) => { setProfileId(value); setGroups([]); setActiveQuery(''); const url = new URL(window.location.href); if (value) url.searchParams.set('profile', value); else url.searchParams.delete('profile'); url.searchParams.delete('q'); window.history.replaceState({}, '', url); }} required={false} />
          <label><span className="muted">Job title or search terms</span><input className="input" value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder={termCount ? 'Add more titles, keywords, or sites…' : 'Director of Quality Engineering remote'} /></label>
          <div className="search-page-actions"><button className="button" type="submit" disabled={loading}>{loading ? 'Preparing search…' : 'Search jobs'}</button>{activeQuery && <button className="button ghost" type="button" onClick={clearResults}>Clear results</button>}</div>
        </form>
        {!!visibleGroups.length && <section className="active-search-terms" aria-label="Active search terms"><div className="active-search-heading"><h3>Active search terms</h3><span>{termCount}</span></div>{visibleGroups.map((group) => <div className="search-term-group" key={group.id}><p>{group.label}</p><div className="search-term-chips">{group.terms.map((term) => <button type="button" className="search-term-chip" key={term} onClick={() => removeTerm(group.id, term)}><span>{term}</span><b aria-hidden="true">×</b><span className="sr-only">Remove {term}</span></button>)}</div></div>)}</section>}
        {siteGroup && (
          <details className="search-sites-disclosure">
            <summary className="muted">Sites searched ({siteGroup.terms.length})</summary>
            <ul className="search-sites-list">
              {siteGroup.terms.map((term) => <li key={term}>{term}</li>)}
            </ul>
          </details>
        )}
        {hiddenCount > 0 && <button className="button secondary restore-results-button" type="button" onClick={restoreResults} title={deadCount ? `${deadCount} flagged as dead links` : undefined}>Restore hidden results ({hiddenCount})</button>}
        <p className="notice" aria-live="polite">{message}</p>
      </article>
      <article className="card search-page-results-column">
        <div className="section-heading search-page-column-heading"><div><span className="eyebrow">Results</span><h2 style={{ marginTop: 14 }}>Current job matches</h2></div><p>Applied jobs and postings you flag as dead links stay hidden until restored.</p></div>
        {activeQuery ? <GoogleJobSearchResults query={activeQuery} profileId={profileId || undefined} /> : <div className="search-empty-state"><h2>No search results yet</h2><p>Select a professional profile or enter a title, then press Search jobs.</p></div>}
      </article>
    </section>
  );
}
