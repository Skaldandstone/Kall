'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';

const API = '/api/kall';

type Preferences = {
  email_enabled: boolean;
  push_enabled: boolean;
  delivery_mode: 'digest' | 'immediate';
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  email_provider_status?: string;
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

  const load = useCallback(() => {
    setMessage('');
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

  useEffect(() => { load(); }, [load]);

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
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.detail === 'string' ? body.detail : 'Check your time zone and quiet-hour times, then try again.');
      }
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
        <p role={message ? 'alert' : 'status'} className={message ? 'notice' : 'muted'}>{message || 'Loading notification settings…'}</p>
        {message && <button className="button secondary" type="button" onClick={load}>Try again</button>}
      </section>
    );
  }

  return (
    <form className="card stack" onSubmit={save} aria-busy={saving}>
      {preferences.email_provider_status === 'unconfigured' && (
        <p className="notice" role="status">Email delivery is not configured yet. Your preferences will be saved, but Kall cannot send email until a verified sender is ready.</p>
      )}
      <div>
        <h2>Morning Brief</h2>
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
        Email me briefs and opportunity alerts
      </label>

      {preferences.email_enabled && (
        <div className="two">
          <label>
            Brief and digest hour
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

      <div className="stack">
        <h2>New opportunities</h2>
        <label>
          Opportunity delivery
          <select className="input" value={preferences.delivery_mode} onChange={(event) => update('delivery_mode', event.target.value as Preferences['delivery_mode'])}>
            <option value="digest">Daily digest</option>
            <option value="immediate">Immediate summary</option>
          </select>
        </label>
        <p className="muted">Immediate mode groups new matches into one email per check. Digest mode saves them for your chosen local hour. Morning Brief stays separate.</p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={Boolean(preferences.quiet_hours_start && preferences.quiet_hours_end)} onChange={(event) => {
            update('quiet_hours_start', event.target.checked ? '22:00' : null);
            update('quiet_hours_end', event.target.checked ? '07:00' : null);
          }} />
          Hold email during quiet hours
        </label>
        {preferences.quiet_hours_start && preferences.quiet_hours_end && (
          <div className="two">
            <label>Quiet hours start<input className="input" type="time" required value={preferences.quiet_hours_start.slice(0, 5)} onChange={(event) => update('quiet_hours_start', event.target.value)} /></label>
            <label>Quiet hours end<input className="input" type="time" required value={preferences.quiet_hours_end.slice(0, 5)} onChange={(event) => update('quiet_hours_end', event.target.value)} /></label>
          </div>
        )}
        <p className="muted">Quiet hours use your time zone, including daylight saving time. Waiting opportunities are combined into one summary.</p>
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
        {message && <p role={message === 'Saved.' ? 'status' : 'alert'} className={message === 'Saved.' ? 'muted' : 'notice'}>{message}</p>}
      </div>
    </form>
  );
}
