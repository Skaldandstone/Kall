'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { showToast } from '../components/ToastHost';
import {
  RECORD_RESOURCES,
  RECORD_SCHEMAS,
  RecordField,
  resourceLabel,
  splitList,
} from './recordSchema';

const API = '/api/kall';

type Row = Record<string, unknown>;
type SkillCheck = { input: string; canonical: string | null; suggestion: string | null };

/** Coerce one form value to what the API expects for its field kind. */
function readField(field: RecordField, form: FormData): unknown {
  if (field.kind === 'checkbox') return form.get(field.name) === 'on';
  const raw = String(form.get(field.name) ?? '').trim();
  if (!raw) return undefined;
  if (field.kind === 'list') return splitList(raw);
  if (field.kind === 'number') {
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  }
  return raw;
}

function titleOf(row: Row, titleFields: readonly string[]) {
  for (const name of titleFields) {
    const value = row[name];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return 'Untitled';
}

/** Saved rows read as a definition list, not a JSON dump. */
function detailsOf(row: Row, fields: readonly RecordField[], titleFields: readonly string[]) {
  return fields
    .filter((field) => !titleFields.includes(field.name))
    .map((field) => [field, row[field.name]] as const)
    .filter(([, value]) => value !== null && value !== undefined && value !== '' && value !== false)
    .map(([field, value]) => ({
      label: field.label,
      value: Array.isArray(value) ? value.join(', ') : value === true ? 'Yes' : String(value),
    }))
    .filter((item) => item.value.length > 0);
}

export default function RecordTab() {
  const [resource, setResource] = useState('skills');
  const [rows, setRows] = useState<Row[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  // Bulk skill entry, plus whatever the spell check had to say about it.
  const [skillNames, setSkillNames] = useState('');
  const [checks, setChecks] = useState<SkillCheck[] | null>(null);

  // Read inside load() to tell a stale response from a current one.
  const resourceRef = useRef(resource);

  const schema = RECORD_SCHEMAS[resource];

  async function load(selected = resource) {
    const response = await fetch(`${API}/profile/resources/${selected}`);
    if (response.status === 401) { window.location.replace('/sign-in'); return; }
    // Ignore a response for a section the user has already switched away from,
    // or a slow request can overwrite the rows of the section now on screen.
    if (response.ok && selected === resourceRef.current) setRows(await response.json());
  }

  useEffect(() => {
    resourceRef.current = resource;
    setMessage('');
    setChecks(null);
    setSkillNames('');
    // Drop the previous section's rows immediately. Rendering them against the
    // new section's schema produced a list of "Untitled" entries for the beat
    // before the fetch landed, because none of their fields matched.
    setRows([]);
    void load(resource);
  }, [resource]);

  async function post(data: Record<string, unknown>) {
    const response = await fetch(`${API}/profile/resources/${resource}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
    if (response.status === 401) { window.location.replace('/sign-in'); return false; }
    return response.ok;
  }

  async function createStructured(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const data: Record<string, unknown> = {};
    for (const field of schema.fields) {
      const value = readField(field, form);
      if (value !== undefined) data[field.name] = value;
    }
    setBusy(true);
    const ok = await post(data);
    setBusy(false);
    setMessage(ok ? `${resourceLabel(schema.singular)} added.` : 'Unable to add that record.');
    if (ok) { formElement.reset(); void load(); }
  }

  /**
   * Step one of adding skills: check the spelling before anything is saved.
   *
   * Advisory only. The vocabulary cannot be complete, so an unrecognised skill
   * comes back with no suggestion and saves exactly as typed -- the check
   * exists to catch "Kubernets", not to police what counts as a skill.
   */
  async function checkSpelling(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const names = splitList(skillNames);
    if (!names.length) { setMessage('Enter at least one skill.'); return; }
    setBusy(true);
    try {
      const response = await fetch(`${API}/profile/skills/spellcheck`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      });
      if (response.status === 401) { window.location.replace('/sign-in'); return; }
      // A spell check that is down must not block adding skills.
      setChecks(response.ok ? await response.json() : names.map((input) => ({ input, canonical: null, suggestion: null })));
      setMessage('');
    } finally {
      setBusy(false);
    }
  }

  function applySuggestion(index: number) {
    setChecks((current) =>
      current?.map((check, position) =>
        position === index && check.suggestion
          ? { ...check, input: check.suggestion, canonical: check.suggestion, suggestion: null }
          : check,
      ) ?? null,
    );
  }

  async function saveSkills() {
    if (!checks?.length) return;
    setBusy(true);
    // Save the vocabulary's spelling when the term is recognised, so "python"
    // and "Python" do not become two different skills on the profile.
    const results = await Promise.all(
      checks.map((check) => post({ name: check.canonical ?? check.input })),
    );
    setBusy(false);
    const added = results.filter(Boolean).length;
    if (added) {
      showToast(`Added ${added} skill${added === 1 ? '' : 's'}.`, 'success');
      setSkillNames('');
      setChecks(null);
      void load();
    }
    if (added < results.length) setMessage(`${results.length - added} skill(s) could not be saved.`);
  }

  return (
    <section className="record-layout">
      <article className="card">
        <h1>Professional record</h1>
        <label>
          <span className="muted">Section</span>
          <select
            className="input"
            name="resource"
            value={resource}
            onChange={(event) => setResource(event.target.value)}
          >
            {RECORD_RESOURCES.map((name) => (
              <option key={name} value={name}>{resourceLabel(name)}</option>
            ))}
          </select>
        </label>

        {resource === 'skills' ? (
          <>
            <p className="record-intro">Add several at once, separated by commas. Kall checks the spelling before saving.</p>
            <form className="form" onSubmit={checkSpelling}>
              <label>
                <span className="muted">Skills</span>
                <input
                  className="input"
                  name="skill_names"
                  value={skillNames}
                  onChange={(event) => { setSkillNames(event.target.value); setChecks(null); }}
                  placeholder="Python, Kubernetes, Test Automation"
                />
              </label>
              <button className="button" disabled={busy}>Check spelling</button>
            </form>

            {checks && (
              <section className="skill-check" aria-label="Spelling check results">
                <h3>Ready to add</h3>
                <ul className="skill-check-list">
                  {checks.map((check, index) => (
                    <li key={`${check.input}-${index}`}>
                      <div className="skill-check-row">
                        <span className="skill-check-name">{check.canonical ?? check.input}</span>
                        {!check.suggestion && (
                          <span className="muted">{check.canonical ? 'Recognised' : 'Kept as typed'}</span>
                        )}
                      </div>
                      {check.suggestion && (
                        <div className="skill-check-suggestion">
                          {/* One text node, not several: this row is a flex
                              container, and separate nodes would each become a
                              flex item and pick up the gap between them. */}
                          <span>Did you mean <strong>{check.suggestion}</strong>?</span>
                          <button type="button" className="button ghost" onClick={() => applySuggestion(index)}>
                            Use {check.suggestion}
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                <button type="button" className="button" onClick={saveSkills} disabled={busy}>
                  Add {checks.length} skill{checks.length === 1 ? '' : 's'}
                </button>
              </section>
            )}
          </>
        ) : (
          <form className="form" onSubmit={createStructured}>
            {schema.fields.map((field) => (
              <label key={field.name}>
                <span className="muted">{field.label}{field.required ? ' *' : ''}</span>
                {field.kind === 'textarea' ? (
                  <textarea className="input" name={field.name} rows={3} required={field.required} />
                ) : field.kind === 'select' ? (
                  <select className="input" name={field.name} defaultValue="" required={field.required}>
                    <option value="" disabled={field.required}>Select…</option>
                    {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : field.kind === 'checkbox' ? (
                  <input type="checkbox" name={field.name} />
                ) : (
                  <input
                    className="input"
                    name={field.name}
                    type={field.kind === 'date' ? 'date' : field.kind === 'number' ? 'number' : 'text'}
                    step={field.kind === 'number' ? 'any' : undefined}
                    required={field.required}
                  />
                )}
                {field.help && <small className="muted">{field.help}</small>}
              </label>
            ))}
            <button className="button" disabled={busy}>Add {schema.singular}</button>
          </form>
        )}
        {message && <p className="notice" role="status">{message}</p>}
      </article>

      <article className="card">
        <h2>Saved {resourceLabel(resource)}</h2>
        {rows.length === 0 && <p className="muted">No records yet.</p>}
        {rows.map((row) => {
          const details = detailsOf(row, schema.fields, schema.titleFields);
          return (
            <section className="record-row" key={String(row.id)}>
              <h3>{titleOf(row, schema.titleFields)}</h3>
              {details.length > 0 && (
                <dl className="record-details">
                  {details.map((item) => (
                    <div key={item.label}>
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          );
        })}
      </article>
    </section>
  );
}
