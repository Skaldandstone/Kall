'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import GoogleJobSearchResults, { type SiteQuery } from './GoogleJobSearchResults';

type ProfileEvent = CustomEvent<{ value: string }>;

export default function OpportunitiesAtsSearch() {
  const pathname = usePathname();
  const [profileId, setProfileId] = useState('');
  const [plan, setPlan] = useState<SiteQuery[]>([]);
  const [activeQueries, setActiveQueries] = useState<SiteQuery[]>([]);
  const [message, setMessage] = useState('Select a professional profile to prepare its unified job search.');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (pathname !== '/opportunities') return;
    const params = new URLSearchParams(window.location.search);
    const profile = params.get('profile');
    if (profile) setProfileId(profile);

    const listener = (event: Event) => {
      const value = (event as ProfileEvent).detail?.value || '';
      setProfileId(value);
      setPlan([]);
      setActiveQueries([]);
    };
    window.addEventListener('kall:professional-profile-change', listener);
    return () => window.removeEventListener('kall:professional-profile-change', listener);
  }, [pathname]);

  useEffect(() => {
    if (pathname !== '/opportunities' || !profileId) return;
    setLoading(true);
    setMessage('Preparing a Google search for every configured job source…');
    fetch(`/api/kall/discovery/ats-search/${profileId}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          const detail = typeof data.detail === 'string' ? data.detail : 'Unable to prepare job search.';
          throw new Error(detail);
        }
        return data;
      })
      .then((data) => {
        setPlan((data.queries as SiteQuery[] | undefined) || []);
        setMessage('Your searches are ready — one real query per job source, queued together.');
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Unable to prepare job search.'))
      .finally(() => setLoading(false));
  }, [pathname, profileId]);

  if (pathname !== '/opportunities') return null;

  function searchJobs() {
    if (!plan.length || !profileId) {
      setMessage('Select a profile before searching.');
      return;
    }
    setActiveQueries(plan);
    const url = new URL(window.location.href);
    url.searchParams.set('profile', profileId);
    window.history.replaceState({}, '', url);
    setMessage(`Queued ${plan.length} site searches. Choose Apply with Kall beside any result to begin preparation.`);
  }

  function clearResults() {
    setActiveQueries([]);
    setMessage('Search results cleared.');
  }

  return (
    <section className="shell opportunity-search-workspace" style={{ marginTop: 32, marginBottom: 32 }}>
      <div className="opportunity-search-columns">
        <article className="card opportunity-search-controls">
          <span className="eyebrow">Unified job search</span>
          <h2 style={{ marginTop: 14 }}>Search every configured job source</h2>
          <p>Google Programmable Search covers Kall’s configured ATS domains and public LinkedIn job pages.</p>
          <p className="notice" aria-live="polite" style={{ marginTop: 18 }}>{loading ? 'Preparing search…' : message}</p>
          <div className="stack" style={{ marginTop: 18 }}>
            <button className="button" type="button" onClick={searchJobs} disabled={!plan.length || loading}>
              Search jobs
            </button>
            <a className="button secondary" href={profileId ? `/search?profile=${profileId}` : '/search'}>
              Open search workspace
            </a>
            {activeQueries.length > 0 && <button className="button ghost" type="button" onClick={clearResults}>Clear results</button>}
          </div>
          <div className="search-application-note">
            <h3>Application handoff</h3>
            <p>Each result can be imported into Kall, paired with this profile and a selected resume, then prepared for review.</p>
          </div>
        </article>

        <article className="card opportunity-search-results-column" aria-label="Unified job search results">
          <div className="section-heading">
            <div><span className="eyebrow">Open roles</span><h2 style={{ marginTop: 14 }}>Results for these criteria</h2></div>
            <p>Results remain inside Kall. Choose Apply with Kall to select documents and preparation preferences.</p>
          </div>
          {activeQueries.length ? (
            <GoogleJobSearchResults queries={activeQueries} profileId={profileId} />
          ) : (
            <div className="search-empty-state">
              <h2>No search results yet</h2>
              <p>Select a professional profile above, then use Search jobs.</p>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
