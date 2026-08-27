'use client';

import AppNav from '../../components/AppNav';
import IdentityPanel from './IdentityPanel';

/**
 * Identity used to be a tab on /profiles, alongside target roles and
 * compensation. It never belonged there: those are career *strategy* -- a user
 * can have several -- while this is the one set of facts about the person, and
 * it is what people look for under account settings. /profiles?tab=identity
 * redirects here so older links still land.
 */
export default function IdentitySettingsPage() {
  return (
    <main className="shell">
      <AppNav />
      <section className="hero" style={{ paddingTop: 32, paddingBottom: 36 }}>
        <span className="eyebrow">
          <a href="/settings">Account settings</a> / Identity
        </span>
        <h1 style={{ fontSize: 'clamp(42px, 7vw, 72px)' }}>Identity &amp; contact</h1>
        <p>
          Your registration and onboarding details, loaded automatically. Update them here whenever
          anything changes -- Kall uses them to fill applications on your behalf.
        </p>
      </section>
      <IdentityPanel />
    </main>
  );
}
