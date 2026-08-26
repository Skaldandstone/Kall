'use client';

import { useEffect, useState } from 'react';

const API = '/api/kall';

type Field = {
  path: string;
  label: string;
  value: string | boolean | number;
  tier: 'always' | 'opt_in' | 'always_confirm';
  requires_confirmation: boolean;
};

type Omitted = { path: string; label: string; reason: string };

type Pack = {
  application_id: number;
  job: { company: string | null; title: string | null; url: string | null };
  provider: string;
  fields: Field[];
  resume: { resume_id: number; filename: string; mime_type: string; download_url: string } | null;
  screening_answers: Array<{ key: string; prompt: string; value: string | null; requires_confirmation: boolean }>;
  omitted: Omitted[];
};

function displayValue(value: Field['value']) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export default function AutofillPanel({ applicationId }: { applicationId: string }) {
  const [pack, setPack] = useState<Pack | null>(null);
  const [message, setMessage] = useState('Loading what Kall can pre-fill…');
  // EEO and work authorization are never sent unless the user opts in here,
  // per application. Defaults to off, matching EEOProfile.decline_to_answer_defaults.
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch(`${API}/applications/${applicationId}/autofill-pack`)
      .then(async (response) => {
        if (response.status === 401) {window.location.replace('/sign-in'); return; }
        if (!response.ok) { setMessage('Unable to load the autofill preview.'); return; }
        setPack(await response.json());
        setMessage('');
      })
      .catch(() => setMessage('Kall could not reach the API.'));
  }, [applicationId]);

  if (!pack) return <section className="card" style={{ marginTop: 24 }}><p className="notice">{message}</p></section>;

  const auto = pack.fields.filter((field) => !field.requires_confirmation);
  const needsConfirmation = pack.fields.filter((field) => field.requires_confirmation);
  const confirmedCount = needsConfirmation.filter((field) => confirmed[field.path]).length;

  return (
    <section className="card" style={{ marginTop: 24 }}>
      <span className="eyebrow">One-click apply</span>
      <h2 style={{ marginTop: 12 }}>What Kall will fill in for you</h2>
      <p>
        Kall pre-fills the employer&apos;s form. You review it there and press Submit yourself —
        Kall never submits an application on your behalf.
      </p>

      <h3 style={{ marginTop: 24 }}>Filled automatically ({auto.length})</h3>
      {auto.length === 0 ? (
        <p className="muted">Nothing yet — add details to your profile and they will appear here.</p>
      ) : (
        <div className="stack" style={{ marginTop: 12 }}>
          {auto.map((field) => (
            <div key={field.path} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <span className="muted">{field.label}</span>
              <strong>{displayValue(field.value)}</strong>
            </div>
          ))}
        </div>
      )}

      {needsConfirmation.length > 0 && (
        <>
          <h3 style={{ marginTop: 26 }}>Needs your confirmation ({confirmedCount} of {needsConfirmation.length})</h3>
          <p className="muted">
            Voluntary self-identification and legal work-authorization answers. These stay blank
            unless you turn them on for this application.
          </p>
          <div className="stack" style={{ marginTop: 12 }}>
            {needsConfirmation.map((field) => (
              <label key={field.path} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(confirmed[field.path])}
                    onChange={(event) => setConfirmed((current) => ({ ...current, [field.path]: event.target.checked }))}
                  />
                  <span>{field.label}</span>
                </span>
                <strong>{confirmed[field.path] ? displayValue(field.value) : 'Prefer not to answer'}</strong>
              </label>
            ))}
          </div>
        </>
      )}

      <h3 style={{ marginTop: 26 }}>Resume</h3>
      {pack.resume ? (
        <p>
          <a href={`${API}/me/resumes/${pack.resume.resume_id}/download`} target="_blank" rel="noreferrer">
            <strong>{pack.resume.filename}</strong>
          </a>{' '}
          will be attached.
        </p>
      ) : (
        <p className="muted">No resume attached to this application.</p>
      )}

      {pack.omitted.length > 0 && (
        <>
          <h3 style={{ marginTop: 26 }}>Not filled ({pack.omitted.length})</h3>
          <p className="muted">You will need to enter these on the employer&apos;s form yourself.</p>
          <div className="stack" style={{ marginTop: 12 }}>
            {pack.omitted.map((row) => (
              <div key={row.path} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <span>{row.label}</span>
                <span className="muted">{row.reason}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {pack.job.url && (
        <div style={{ marginTop: 26 }}>
          <a className="button" href={pack.job.url} target="_blank" rel="noreferrer">Open the application form</a>
        </div>
      )}
    </section>
  );
}
