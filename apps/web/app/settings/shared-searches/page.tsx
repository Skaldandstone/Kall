'use client';

import AppNav from '../../components/AppNav';
import SharedSearchSettings from './SharedSearchSettings';

export default function SharedSearchesPage() {
  return (
    <main className="shell">
      <AppNav />
      <section className="hero" style={{ paddingTop: 32, paddingBottom: 36 }}>
        <span className="eyebrow">
          <a href="/settings">Account settings</a> / Help a friend
        </span>
        <h1 style={{ fontSize: 'clamp(28px, 7vw, 72px)' }}>Help a friend find a job.</h1>
        <p>
          Share a batch of matching openings with someone — no Kall account required on their
          end. You never apply for them; the page just links out to the real postings.
        </p>
      </section>
      <SharedSearchSettings />
    </main>
  );
}
