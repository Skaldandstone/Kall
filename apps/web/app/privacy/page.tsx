'use client';

import { FormEvent, useEffect, useState } from 'react';
import KallMark from '../components/KallMark';

const API = '/api/kall';
const fields = ['identity.phone', 'identity.address', 'eeo.veteran_status', 'eeo.disability_status', 'work_authorization.citizenship', 'references.contact'];

export default function PrivacyPage() {
  const [rules, setRules] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const token = () => localStorage.getItem('kall_token');

  async function load() {
    const response = await fetch(`${API}/profile/privacy`, { headers: { Authorization: `Bearer ${token()}` } });
    if (response.status === 401) { localStorage.removeItem('kall_token'); window.location.replace('/login'); return; }
    if (response.ok) setRules(await response.json());
  }

  useEffect(() => { load(); }, []);

  async function save(field: string, scopes: string[], confirm = true) {
    const response = await fetch(`${API}/profile/privacy/${field}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ field_path: field, scopes, require_confirmation: confirm }),
    });
    if (response.status === 401) { localStorage.removeItem('kall_token'); window.location.replace('/login'); return; }
    setMessage(response.ok ? 'Privacy setting saved.' : 'Unable to save privacy setting.');
    if (response.ok) load();
  }

  async function saveSensitive(event: FormEvent<HTMLFormElement>, endpoint: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const response = await fetch(`${API}/profile/${endpoint}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(payload),
    });
    if (response.status === 401) { localStorage.removeItem('kall_token'); window.location.replace('/login'); return; }
    setMessage(response.ok ? 'Encrypted profile saved.' : 'Unable to save profile.');
  }

  return <main className="shell">
    <header className="topbar"><div className="brand"><KallMark />Kall Privacy</div><a href="/profiles">Career</a></header>
    <section className="grid">
      <article className="card"><h1>Field-level privacy</h1><p>Choose how each field may be used. Sensitive fields can never be public.</p>
        {fields.map(field => <div key={field} style={{ borderTop: '1px solid #eee', padding: '14px 0' }}><b>{field}</b><div style={{ marginTop: 8 }}>
          <button className="button secondary" onClick={() => save(field, ['private'])}>Private</button>{' '}
          <button className="button secondary" onClick={() => save(field, ['tailoring'], true)}>Tailoring</button>{' '}
          <button className="button secondary" onClick={() => save(field, ['autofill'], true)}>Autofill</button>
        </div></div>)}
      </article>
      <article className="card"><h2>EEO profile</h2><form className="form" onSubmit={e => saveSensitive(e, 'eeo')}>
        <input className="input" name="veteran_status" placeholder="Veteran status" />
        <input className="input" name="disability_status" placeholder="Disability status" />
        <input className="input" name="race_ethnicity" placeholder="Race or ethnicity" />
        <input className="input" name="gender_identity" placeholder="Gender identity" />
        <button className="button">Save encrypted EEO profile</button>
      </form></article>
      <article className="card"><h2>Work authorization</h2><form className="form" onSubmit={e => saveSensitive(e, 'work-authorization')}>
        <input className="input" name="country" placeholder="Country" required />
        <input className="input" name="authorization_type" placeholder="Authorization type" required />
        <input className="input" name="citizenship_status" placeholder="Citizenship status" />
        <input className="input" name="visa_type" placeholder="Visa type" />
        <button className="button">Save encrypted authorization</button>
      </form></article>
    </section><p>{message}</p>
  </main>;
}
