'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AppNav from '../components/AppNav';
import StrategyTab from './StrategyTab';
import IdentityTab from './IdentityTab';
import RecordTab from './RecordTab';
import GrowthTab from './GrowthTab';
import AchievementsTab from './AchievementsTab';
import ReferencesTab from './ReferencesTab';
import styles from './page.module.css';

const TABS = [
  ['strategy', 'Strategy'],
  ['identity', 'Identity'],
  ['record', 'Professional record'],
  ['growth', 'Growth'],
  ['achievements', 'Achievements'],
  ['references', 'References'],
] as const;

export default function ProfilesPage() {
  return <Suspense fallback={null}><ProfilesPageContent /></Suspense>;
}

function ProfilesPageContent() {
  const params = useSearchParams();
  const tab = params.get('tab') || 'strategy';

  return (
    <main className={styles.shell}>
      <AppNav current="career" />
      <section className={styles.hero}>
        <div>
          <p className="eyebrow">Career</p>
          <h1>Define where your career should go.</h1>
        </div>
      </section>
      <nav aria-label="Career sections" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
        {TABS.map(([key, label]) => (
          <a
            key={key}
            href={key === 'strategy' ? '/profiles' : `/profiles?tab=${key}`}
            className={`button ${tab === key ? '' : 'secondary'}`}
            aria-current={tab === key ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      {tab === 'strategy' && <StrategyTab />}
      {tab === 'identity' && <IdentityTab />}
      {tab === 'record' && <RecordTab />}
      {tab === 'growth' && <GrowthTab />}
      {tab === 'achievements' && <AchievementsTab />}
      {tab === 'references' && <ReferencesTab />}
    </main>
  );
}
