'use client';

import { Suspense } from 'react';
import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import AppNav from '../components/AppNav';
import StrategyTab from './StrategyTab';
import RecordTab from './RecordTab';
import EmploymentTab from './EmploymentTab';
import GrowthTab from './GrowthTab';
import AchievementsTab from './AchievementsTab';
import ReferencesTab from './ReferencesTab';
import styles from './page.module.css';

const TABS = [
  ['strategy', 'Direction'],
  ['employment', 'Work history'],
  ['record', 'Professional record'],
  ['growth', 'Career plan'],
  ['achievements', 'Achievements'],
  ['references', 'References'],
] as const;

export default function ProfilesPage() {
  return <Suspense fallback={null}><ProfilesPageContent /></Suspense>;
}

function ProfilesPageContent() {
  const params = useSearchParams();
  const tab = params.get('tab') || 'strategy';

  // Identity moved to account settings, where it belongs -- these are facts
  // about the person, not one of several career strategies. Bookmarks and
  // older links still point here, so send them on rather than 404-ing them
  // into the Strategy tab with no explanation.
  useEffect(() => {
    if (tab === 'identity') window.location.replace('/settings/identity');
  }, [tab]);
  if (tab === 'identity') return null;

  return (
    <main className={styles.shell}>
      <AppNav current="career" />
      <section className={styles.hero}>
        <div>
          <p className="eyebrow">Career</p>
          <h1>Keep the record Kall uses to represent you.</h1>
          <p>Separate stable career facts from the roles, locations, and conditions you want to pursue.</p>
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
      {tab === 'employment' && <EmploymentTab />}
      {tab === 'record' && <RecordTab />}
      {tab === 'growth' && <GrowthTab />}
      {tab === 'achievements' && <AchievementsTab />}
      {tab === 'references' && <ReferencesTab />}
    </main>
  );
}
