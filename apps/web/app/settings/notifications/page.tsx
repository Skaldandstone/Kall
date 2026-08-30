'use client';

import AppNav from '../../components/AppNav';
import NotificationSettings from './NotificationSettings';

export default function NotificationSettingsPage() {
  return (
    <main className="shell">
      <AppNav />
      <section className="hero" style={{ paddingTop: 32, paddingBottom: 36 }}>
        <span className="eyebrow">
          <a href="/settings">Account settings</a> / Notifications
        </span>
        <h1 style={{ fontSize: 'clamp(28px, 7vw, 72px)' }}>Notifications</h1>
        <p>
          Choose when Kall emails you and what it emails you about. Nothing is sent until you
          save -- these are the same settings the daily brief and new-opportunity alerts read.
        </p>
      </section>
      <NotificationSettings />
    </main>
  );
}
