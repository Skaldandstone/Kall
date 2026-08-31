'use client';

import { FormEvent, useEffect, useState } from 'react';

const API = '/api/kall';

type Source = { id: number; provider: string; company_name: string; board_key: string };

export default function SourcesTab() {
  const [rows, setRows] = useState<Source[]>([]);
  const [message, setMessage] = useState('');

  async function load() {
    const response = await fetch(`${API}/me/search-sources`);
    if (response.ok) setRows(await response.json());
  }

  useEffect(() => { void load(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Capture the form element before the await -- the native event's
    // currentTarget is nulled out once dispatch finishes, so reading it
    // after an await throws "Cannot read properties of null".
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const response = await fetch(`${API}/me/search-sources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: form.get('provider'), company_name: form.get('company'), board_key: form.get('board_key'), enabled: true }),
    });
    setMessage(response.ok ? 'Source added.' : 'Could not add source.');
    if (response.ok) { formElement.reset(); void load(); }
  }

  return (
    <div className="grid">
      <article className="card">
        <h2>Add a company job board</h2>
        <form className="form" onSubmit={submit}>
          <label><span className="muted">Job board provider</span><select className="input" name="provider">
            <option value="greenhouse">Greenhouse</option>
            <option value="lever">Lever</option>
            <option value="ashby">Ashby</option>
          </select></label>
          <label><span className="muted">Company name</span><input className="input" name="company" required /></label>
          <label><span className="muted">Board key or slug</span><input className="input" name="board_key" required /></label>
          <button className="button" type="submit">Add source</button>
        </form>
        <p className="notice" aria-live="polite">{message}</p>
      </article>
      <article className="card">
        <h2>Configured sources</h2>
        {rows.map((row) => <p key={row.id}><b>{row.company_name}</b> · {row.provider} · {row.board_key}</p>)}
        {rows.length === 0 && <p className="muted">No company boards configured yet.</p>}
      </article>
    </div>
  );
}
