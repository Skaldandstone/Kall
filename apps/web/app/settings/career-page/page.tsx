'use client';

import AppNav from '../../components/AppNav';
import CareerPageEditor from './CareerPageEditor';

export default function CareerPageSettings() {
  return (
    <main className="shell">
      <AppNav />
      <section className="hero" style={{ paddingTop: 32, paddingBottom: 36 }}>
        <span className="eyebrow">
          <a href="/settings">Account settings</a> / Career page
        </span>
        <h1 style={{ fontSize: 'clamp(42px, 7vw, 72px)' }}>Your career page</h1>
        <p>
          One page you can send instead of a resume. Choose what it says, in what order, and
          who can see it -- nothing is public until you publish.
        </p>
      </section>
      <CareerPageEditor />
    </main>
  );
}
