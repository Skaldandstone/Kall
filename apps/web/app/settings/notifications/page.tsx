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
        <h1 style={{ fontSize: 'clamp(42px, 7vw, 72px)' }}>Notifications</h1>
        <p>
          Set opportunity delivery, email timing, and quiet hours. Morning Brief remains a
          separate daily email.
        </p>
      </section>
      <NotificationSettings />
    </main>
  );
}
