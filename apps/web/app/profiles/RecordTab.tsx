'use client';

import { FormEvent, useEffect, useState } from 'react';

const API = '/api/kall';
const resources = ['education', 'skills', 'certifications', 'languages', 'awards', 'publications', 'patents', 'speaking', 'memberships', 'service', 'references'];

export default function RecordTab() {
  const [resource, setResource] = useState('skills');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [message, setMessage] = useState('');

  async function load(selected = resource) {
    const response = await fetch(`${API}/profile/resources/${selected}`);
    if (response.ok) setRows(await response.json());
  }

  useEffect(() => { void load(resource); }, [resource]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(String(form.get('data')));
    } catch {
      setMessage('Enter valid JSON for this profile record.');
      return;
    }
    const response = await fetch(`${API}/profile/resources/${resource}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
    setMessage(response.ok ? 'Profile record added.' : 'Unable to add record.');
    if (response.ok) { formElement.reset(); void load(); }
  }

  return (
    <section className="grid">
      <article className="card">
        <h1>Professional record</h1>
        <select className="input" value={resource} onChange={(event) => setResource(event.target.value)}>
          {resources.map((name) => <option key={name}>{name}</option>)}
        </select>
        <p>Add a structured record. This early editor accepts JSON while richer forms are added per section.</p>
        <form className="form" onSubmit={create}>
          <textarea className="input" name="data" rows={10} placeholder='{"name":"Python","category":"Programming","years_experience":10}' required />
          <button className="button">Add {resource}</button>
        </form>
        <p>{message}</p>
      </article>
      <article className="card">
        <h2>Saved {resource}</h2>
        {rows.length === 0 && <p>No records yet.</p>}
        {rows.map((row) => <pre key={String(row.id)} style={{ whiteSpace: 'pre-wrap', borderTop: '1px solid #eee', paddingTop: 12 }}>{JSON.stringify(row, null, 2)}</pre>)}
      </article>
    </section>
  );
}
