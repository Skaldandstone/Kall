'use client';

import { Suspense } from 'react';
import AppNav from '../../components/AppNav';
import EmailConnectionSettings from './EmailConnectionSettings';

export default function EmailSettingsPage() {
  return (
    <main className="shell">
      <AppNav />
      <section className="hero" style={{ paddingTop: 32, paddingBottom: 36 }}>
        <span className="eyebrow">
          <a href="/settings">Account settings</a> / Email
        </span>
        <h1 style={{ fontSize: 'clamp(28px, 7vw, 72px)' }}>Auto-detect application status from your email.</h1>
        <p>
          Connect Gmail or Outlook and Kall will watch for confirmation, interview, and rejection
          emails and suggest updating the matching application — you always confirm before
          anything changes. Read-only access: Kall can never send, delete, or modify anything in
          your mailbox.
        </p>
      </section>
      <Suspense fallback={null}><EmailConnectionSettings /></Suspense>
    </main>
  );
}
