'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import ProfessionalProfileSelect from '../components/ProfessionalProfileSelect';
import GoogleJobSearchResults, { soloQuery, type SiteQuery } from '../components/GoogleJobSearchResults';
import { deadLinkCount, hiddenSearchResultCount, loadSuppressedResults, restoreHiddenSearchResults } from '../lib/searchResultState';
import { showToast } from '../components/ToastHost';
import { buildQuery, parseQuery, type SearchGroup } from '../lib/searchQuery';

type SiteDomain = { provider: string; domain: string };

function cleanTerm(value: string) {
  return value.trim().replace(/^site:/i, '').replace(/^['"]|['"]$/g, '').trim();
}

function splitNewTerms(value: string) {
  const terms = value.split(/[,\n]+/).map(cleanTerm).filter(Boolean);
  return terms.length ? terms : value.trim() ? [value.trim()] : [];
}

function siteQueriesFor(domains: SiteDomain[], intent: string): SiteQuery[] {
  if (!intent) return [];
  if (!domains.length) return soloQuery(intent);
  return domains.map((site) => ({ provider: site.provider, domain: site.domain, query: `site:${site.domain} ${intent}`.trim() }));
}

/** The profile's title/industry/keyword/location boolean, and the sites it
 * runs against -- a query per site, not one giant query with every site
 * OR'd in (Google stops reading a query after ~32 words, so that used up
 * the whole budget before the boolean anyone actually typed was reached). */
async function fetchProfilePlan(selectedProfile: string): Promise<{ intent: string; domains: SiteDomain[] }> {
  const response = await fetch(`/api/kall/discovery/ats-search/${selectedProfile}`);
  if (response.status === 401) { window.location.replace('/sign-in'); return { intent: '', domains: [] }; }
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Unable to build a profile search.');
  const domains: SiteDomain[] = (data.queries ?? []).map((item: { provider: string; domain: string }) => ({
    provider: item.provider,
    domain: item.domain,
  }));
  return { intent: (data.intent as string) || '', domains };
}

export default function SearchTab() {
  const [profileId, setProfileId] = useState('');
  const [queryInput, setQueryInput] = useState('');
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [siteDomains, setSiteDomains] = useState<SiteDomain[]>([]);
  const [siteQueries, setSiteQueries] = useState<SiteQuery[]>([]);
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
    if (selectedQuery) {
      const parsed = parseQuery(selectedQuery);
      setGroups(parsed);
      if (selectedProfile) {
        fetchProfilePlan(selectedProfile)
          .then(({ domains }) => { setSiteDomains(domains); setSiteQueries(siteQueriesFor(domains, selectedQuery)); })
          .catch(() => setSiteQueries(soloQuery(selectedQuery)));
      } else {
        setSiteQueries(soloQuery(selectedQuery));
      }
    }
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

  async function searchJobs(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage('Preparing your search…');
    try {
      let nextGroups = groups;
      let domains = siteDomains;
      if (profileId) {
        if (!nextGroups.length || !domains.length) {
          const plan = await fetchProfilePlan(profileId);
          if (!nextGroups.length) nextGroups = parseQuery(plan.intent);
          domains = plan.domains;
          setSiteDomains(domains);
        }
      } else if (domains.length) {
        domains = [];
        setSiteDomains([]);
      }
      const additions = splitNewTerms(queryInput);
      if (additions.length) nextGroups = [...nextGroups, { id: `custom-${Date.now()}`, label: 'Added terms', terms: additions }];
      const finalQuery = buildQuery(nextGroups);
      if (!finalQuery) { setMessage('Enter a job title or select a professional profile.'); showToast('Enter a job title or select a professional profile.', 'error'); return; }
      setGroups(nextGroups);
      setQueryInput('');
      setSiteQueries(siteQueriesFor(domains, finalQuery));
      const url = new URL(window.location.href);
      url.searchParams.set('q', finalQuery);
      if (profileId) url.searchParams.set('profile', profileId); else url.searchParams.delete('profile');
      window.history.replaceState({}, '', url);
      setMessage(domains.length
        ? `Queued ${domains.length} site searches — use Previous/Next site in the results column to browse them.`
        : 'Showing Google job results in the results column.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unable to start the job search.';
      setMessage(detail);
      showToast(detail, 'error');
    } finally { setLoading(false); }
  }

  function removeTerm(groupId: string, term: string) {
    const next = groups.map((group) => group.id === groupId ? { ...group, terms: group.terms.filter((item) => item !== term) } : group).filter((group) => group.terms.length);
    setGroups(next);
    const regenerated = buildQuery(next);
    setSiteQueries(siteQueriesFor(siteDomains, regenerated));
    const url = new URL(window.location.href);
    if (regenerated) url.searchParams.set('q', regenerated); else url.searchParams.delete('q');
    window.history.replaceState({}, '', url);
  }

  function clearResults() {
    setGroups([]); setQueryInput(''); setSiteQueries([]);
    const url = new URL(window.location.href); url.searchParams.delete('q'); window.history.replaceState({}, '', url);
    setMessage('Search results cleared.');
  }

  function restoreResults() {
    const currentSiteQueries = siteQueries;
    restoreHiddenSearchResults();
    setHiddenCount(0);
    setDeadCount(0);
    showToast('Hidden results restored, including flagged dead links.', 'success');
    if (currentSiteQueries.length) {
      setSiteQueries([]);
      window.setTimeout(() => setSiteQueries(currentSiteQueries), 0);
    }
  }

  // "Sites" only ever appears here for a site: term someone typed into the
  // free-text box themselves -- a profile's own boolean never contains one
  // (see build_search_intent), since sites now drive a separate query per
  // domain rather than living inside this text at all.
  const visibleGroups = groups.filter((group) => group.label !== 'Sites');
  const siteGroup = groups.find((group) => group.label === 'Sites');
  const termCount = useMemo(
    () => visibleGroups.reduce((count, group) => count + group.terms.length, 0),
    [visibleGroups],
  );

  return (
    <section className="search-page-columns" aria-label="Job search criteria and results">
      <article className="card search-page-controls-column">
        <div className="section-heading search-page-column-heading"><div><span className="eyebrow">Search criteria</span><h2 style={{ marginTop: 14 }}>Choose what belongs in this search</h2></div></div>
        <form className="form" onSubmit={searchJobs}>
          <ProfessionalProfileSelect
            value={profileId}
            onChange={(value) => {
              setProfileId(value);
              setGroups([]); setSiteDomains([]); setSiteQueries([]);
              const url = new URL(window.location.href);
              if (value) url.searchParams.set('profile', value); else url.searchParams.delete('profile');
              url.searchParams.delete('q');
              window.history.replaceState({}, '', url);
            }}
            required={false}
          />
          <label><span className="muted">Job title or search terms</span><input className="input" value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder={termCount ? 'Add more titles, keywords, or sites…' : 'Director of Quality Engineering remote'} /></label>
          <div className="search-page-actions"><button className="button" type="submit" disabled={loading}>{loading ? 'Preparing search…' : 'Search jobs'}</button>{siteQueries.length > 0 && <button className="button ghost" type="button" onClick={clearResults}>Clear results</button>}</div>
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
        {!!siteDomains.length && (
          <details className="search-sites-disclosure">
            <summary className="muted">Sites searched ({siteDomains.length})</summary>
            <ul className="search-sites-list">
              {siteDomains.map((site) => <li key={site.domain}>{site.provider} ({site.domain})</li>)}
            </ul>
          </details>
        )}
        {hiddenCount > 0 && <button className="button secondary restore-results-button" type="button" onClick={restoreResults} title={deadCount ? `${deadCount} flagged as dead links` : undefined}>Restore hidden results ({hiddenCount})</button>}
        <p className="notice" aria-live="polite">{message}</p>
      </article>
      <article className="card search-page-results-column">
        <div className="section-heading search-page-column-heading"><div><span className="eyebrow">Open roles</span><h2 style={{ marginTop: 14 }}>Results for these criteria</h2></div><p>Applied jobs and postings you flag as dead links stay hidden until restored.</p></div>
        {siteQueries.length ? <GoogleJobSearchResults queries={siteQueries} profileId={profileId || undefined} /> : <div className="search-empty-state"><h2>No search has run yet</h2><p>Select a career direction or enter a title, then choose Search jobs.</p></div>}
      </article>
    </section>
  );
}
