'use client';

import { useEffect, useState } from 'react';

const API = '/api/kall';

type Prep = { id: number; questions: string[]; notes: string };

export default function InterviewPrepPanel({ applicationId }: { applicationId: string }) {
  const [prep, setPrep] = useState<Prep | null>(null);
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('Loading interview prep…');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API}/me/applications/${applicationId}/interview-prep`)
      .then(async (response) => {
        if (response.status === 401) {window.location.replace('/sign-in'); return; }
        if (!response.ok) { setMessage('Unable to load interview prep.'); return; }
        const body: Prep = await response.json();
        setPrep(body);
        setNotes(body.notes);
        setMessage('');
      })
      .catch(() => setMessage('Kall could not reach the API.'));
  }, [applicationId]);

  async function saveNotes() {
    setSaving(true);
    const response = await fetch(`${API}/me/applications/${applicationId}/interview-prep/notes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    });
    setSaving(false);
    setMessage(response.ok ? 'Notes saved.' : 'Unable to save notes.');
  }

  if (!prep) return <section className="card" style={{ marginTop: 24 }}><p className="notice">{message}</p></section>;

  return (
    <section className="card" style={{ marginTop: 24 }}>
      <span className="eyebrow">Interview prep</span>
      <h2 style={{ marginTop: 12 }}>Likely questions</h2>
      <ul>
        {prep.questions.map((question, index) => <li key={index} style={{ marginBottom: 6 }}>{question}</li>)}
      </ul>

      <h3 style={{ marginTop: 20 }}>Your notes</h3>
      <textarea
        className="input"
        rows={5}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Talking points, questions to ask them, things to look up beforehand…"
      />
      <div style={{ marginTop: 12 }}>
        <button className="button secondary" onClick={() => void saveNotes()} disabled={saving}>Save notes</button>
      </div>
      <p className="notice" aria-live="polite">{message}</p>
    </section>
  );
}
