'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AppNav from '../components/AppNav';
import LibraryTab from './LibraryTab';
import IntelligenceTab from './IntelligenceTab';
import TailoringTab from './TailoringTab';
import GenerateTab from './GenerateTab';
import styles from './page.module.css';

const TABS = [
  ['library', 'Library'],
  ['intelligence', 'Evidence'],
  ['tailoring', 'Tailor for a role'],
  ['generate', 'Export'],
] as const;

export default function ResumesPage() {
  return <Suspense fallback={null}><ResumesPageContent /></Suspense>;
}

function ResumesPageContent() {
  const params = useSearchParams();
  const tab = params.get('tab') || 'library';

  return (
    <main className={styles.shell}>
      <AppNav current="documents" />
      <section className={styles.hero}>
        <div>
          <p className="eyebrow">Documents</p>
          <h1>Keep every resume tied to the facts behind it.</h1>
          <p>Preserve source files, compare versions, and review proposed changes before creating an application document.</p>
        </div>
      </section>
      <nav aria-label="Documents sections" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
        {TABS.map(([key, label]) => (
          <a
            key={key}
            href={key === 'library' ? '/resumes' : `/resumes?tab=${key}`}
            className={`button ${tab === key ? '' : 'secondary'}`}
            aria-current={tab === key ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      {tab === 'library' && <LibraryTab />}
      {tab === 'intelligence' && <IntelligenceTab />}
      {tab === 'tailoring' && <TailoringTab />}
      {tab === 'generate' && <GenerateTab />}
    </main>
  );
}
