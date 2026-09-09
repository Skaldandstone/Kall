'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';

const API = '/api/kall';

type Employment = {
  id: number;
  employer: string;
  job_title: string;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_current: boolean;
  description?: string | null;
};

function authHeaders(json = false) {
  return { ...(json ? { 'Content-Type': 'application/json' } : {}) };
}

// "2020-01-01" through `new Date()` is parsed as UTC midnight and then shown
// in local time, which lands on 2019 for anyone west of Greenwich. These are
// plain calendar dates with no time zone, so read the year off the string.
function year(value?: string | null) {
  return value ? value.slice(0, 4) : '—';
}

function dateRange(row: Employment) {
  return `${year(row.start_date)} – ${row.is_current ? 'Present' : year(row.end_date)}`;
}

export default function EmploymentTab() {
  const [rows, setRows] = useState<Employment[]>([]);
  const [message, setMessage] = useState('Loading your work history…');
  const [busy, setBusy] = useState(false);
  const loadSequence = useRef(0);

  async function load() {
    const sequence = ++loadSequence.current;
    const response = await fetch(`${API}/profile/resources/employment`, { headers: authHeaders() });
    // The initial page request can still be in flight when a newly saved role
    // triggers a refresh. Only the newest response may replace the visible
    // history, otherwise the older empty result can erase the saved card.
    if (sequence !== loadSequence.current) return;
    if (response.status === 401) {window.location.replace('/sign-in'); return; }
    if (!response.ok) { setMessage('Unable to load your work history.'); return; }
    setRows(await response.json());
    setMessage('');
  }

  useEffect(() => { void load(); }, []);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const isCurrent = form.get('is_current') === 'on';
    setBusy(true);
    try {
      const response = await fetch(`${API}/profile/resources/employment`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          data: {
            employer: form.get('employer'),
            job_title: form.get('job_title'),
            location: form.get('location') || null,
            start_date: form.get('start_date') || null,
            // A current role has no end date; sending one would contradict the flag.
            end_date: isCurrent ? null : form.get('end_date') || null,
            is_current: isCurrent,
            description: form.get('description') || null,
          },
        }),
      });
      if (!response.ok) { setMessage('Unable to save that role.'); return; }
      formElement.reset();
      await load();
      setMessage('Role saved.');
    } finally { setBusy(false); }
  }

  async function remove(id: number) {
    const response = await fetch(`${API}/profile/resources/employment/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (response.ok) { await load(); setMessage('Role removed.'); }
    else setMessage('Unable to remove that role.');
  }

  return (
    <>
      <section className="card">
        <h2>Work history</h2>
        <p>
          Employers, titles, and dates. Application forms ask for these constantly, and Kall can only
          pre-fill them for you if they are saved here — a resume alone is free text it cannot reliably read.
        </p>
        <form className="form" onSubmit={add}>
          <div className="two">
            <label><span className="muted">Employer</span><input className="input" name="employer" required /></label>
            <label><span className="muted">Job title</span><input className="input" name="job_title" required /></label>
          </div>
          <label><span className="muted">Location (optional)</span><input className="input" name="location" /></label>
          <div className="two">
            <label><span className="muted">Start date</span><input className="input" name="start_date" type="date" /></label>
            <label><span className="muted">End date</span><input className="input" name="end_date" type="date" /></label>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" name="is_current" />
            <span>This is my current role</span>
          </label>
          <label><span className="muted">Role description (optional)</span><textarea className="input" name="description" rows={3} /></label>
          <button className="button" disabled={busy}>{busy ? 'Saving…' : 'Add role'}</button>
        </form>
        <p className="notice" aria-live="polite">{message}</p>
      </section>

      <section className="stack" style={{ marginTop: 24 }}>
        {rows.length === 0 && !message && (
          <article className="card"><h2>No roles saved yet.</h2><p>Add your current or most recent role above.</p></article>
        )}
        {rows.map((row) => (
          <article className="card" key={row.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div>
                {row.is_current && <span className="pill">Current</span>}
                <h2 style={{ marginTop: row.is_current ? 12 : 0 }}>{row.job_title}</h2>
                <p><strong>{row.employer}</strong>{row.location ? ` · ${row.location}` : ''}</p>
                <p className="muted">{dateRange(row)}</p>
              </div>
              <button className="button ghost" type="button" onClick={() => void remove(row.id)} aria-label={`Remove ${row.job_title} at ${row.employer}`}>Remove</button>
            </div>
            {row.description && <p style={{ marginTop: 12 }}>{row.description}</p>}
          </article>
        ))}
      </section>
    </>
  );
}
