'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AppNav from '../components/AppNav';
import flow from '../components/CurrentFlow.module.css';
import SearchTab from './SearchTab';
import DiscoveryTab from './DiscoveryTab';
import SourcesTab from './SourcesTab';

const TABS = [
  ['search', 'Search'],
  ['discovery', 'Tracked'],
  ['sources', 'Sources'],
] as const;

export default function SearchPage() {
  return <Suspense fallback={null}><SearchPageContent /></Suspense>;
}

function SearchPageContent() {
  const params = useSearchParams();
  const tab = params.get('tab') || 'search';

  return <main className={`app-shell search-page-shell ${flow.shell}`}>
    <AppNav current="opportunities" />
    <section className="hero search-page-hero">
      <span className="eyebrow">Opportunities</span>
      <h1>Find your next role.</h1>
      <p>Search the open web, run configured ATS discovery against your company boards, and manage which boards Kall watches.</p>
    </section>
    <nav className="section-tabs" aria-label="Opportunities sections" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
      {TABS.map(([key, label]) => (
        <a
          key={key}
          href={key === 'search' ? '/search' : `/search?tab=${key}`}
          className={`button ${tab === key ? '' : 'secondary'}`}
          aria-current={tab === key ? 'page' : undefined}
        >
          {label}
        </a>
      ))}
    </nav>
    {tab === 'search' && <SearchTab />}
    {tab === 'discovery' && <DiscoveryTab />}
    {tab === 'sources' && <SourcesTab />}
  </main>;
}
