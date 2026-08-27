'use client';

import { FormEvent, useEffect, useState } from 'react';

const API = '/api/kall';

type Preferences = {
  email_enabled: boolean;
  push_enabled: boolean;
  delivery_mode: string;
  digest_hour_local: number;
  timezone: string;
  minimum_match_score: number;
};

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function hourLabel(hour: number): string {
  const period = hour < 12 ? 'AM' : 'PM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:00 ${period}`;
}

export default function NotificationSettings() {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch(`${API}/notification-preferences`)
      .then(async (response) => {
        if (response.status === 401) {
          window.location.replace('/sign-in');
          return null;
        }
        if (!response.ok) throw new Error('Unable to load notification settings.');
        return response.json();
      })
      .then((data) => { if (data) setPreferences(data); })
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Unable to load notification settings.'));
  }, []);

  function update<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPreferences((current) => (current ? { ...current, [key]: value } : current));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!preferences) return;
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch(`${API}/notification-preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      });
      if (response.status === 401) { window.location.replace('/sign-in'); return; }
      if (!response.ok) throw new Error('Unable to save notification settings.');
      setPreferences(await response.json());
      setMessage('Saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save notification settings.');
    } finally {
      setSaving(false);
    }
  }

  if (!preferences) {
    return (
      <section className="card">
        <p className={message ? 'notice' : 'muted'}>{message || 'Loading…'}</p>
      </section>
    );
  }

  return (
    <form className="card stack" onSubmit={save}>
      <div>
        <h2>Daily brief</h2>
        <p className="muted">
          A short email summarizing where things stand: your best current match, anything
          ready to submit, and your career health score.
        </p>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={preferences.email_enabled}
          onChange={(event) => update('email_enabled', event.target.checked)}
        />
        Email me
      </label>

      {preferences.email_enabled && (
        <div className="two">
          <label>
            Send it around
            <select
              className="input"
              value={preferences.digest_hour_local}
              onChange={(event) => update('digest_hour_local', Number(event.target.value))}
            >
              {HOURS.map((hour) => (
                <option key={hour} value={hour}>{hourLabel(hour)}</option>
              ))}
            </select>
          </label>
          <label>
            In your time zone
            <input
              className="input"
              value={preferences.timezone}
              onChange={(event) => update('timezone', event.target.value)}
              placeholder="e.g. America/Los_Angeles"
            />
          </label>
        </div>
      )}

      <div>
        <h2>New opportunities</h2>
        <p className="muted">Only matches at or above this score are worth an email.</p>
        <label>
          Minimum match score: {preferences.minimum_match_score}%
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={preferences.minimum_match_score}
            onChange={(event) => update('minimum_match_score', Number(event.target.value))}
          />
        </label>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.6 }}>
        <input type="checkbox" checked={false} disabled />
        Push notifications on mobile (coming once app store credentials are set up)
      </label>

      <div className="actions">
        <button className="button" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {message && <p className={message === 'Saved.' ? 'muted' : 'notice'}>{message}</p>}
      </div>
    </form>
  );
}
