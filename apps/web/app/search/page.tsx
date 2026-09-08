'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AppNav from '../components/AppNav';
import flow from '../components/CurrentFlow.module.css';
import SearchTab from './SearchTab';
import DiscoveryTab from './DiscoveryTab';
import SourcesTab from './SourcesTab';
import ConsultingTab from './ConsultingTab';

const TABS = [
  ['search', 'Search'],
  ['discovery', 'Tracked roles'],
  ['sources', 'Company boards'],
  ['consulting', 'Consulting'],
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
      <h1>Search for roles that fit your criteria.</h1>
      <p>Use titles, locations, work preferences, and a saved career direction. Add company boards when you want Kall to check specific employers.</p>
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
    {tab === 'consulting' && <ConsultingTab />}
  </main>;
}
