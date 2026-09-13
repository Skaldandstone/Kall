'use client';

import { FormEvent, useEffect, useState } from 'react';
import styles from './SourcesTab.module.css';

const API = '/api/kall';

type Source = { id: number; provider: string; company_name: string; board_key: string };

const BOARD_KEY_HINT: Record<string, string> = {
  greenhouse: 'The short board token from the company\'s Greenhouse URL, e.g. "acme" from boards.greenhouse.io/acme.',
  lever: 'The short board token from the company\'s Lever URL, e.g. "acme" from jobs.lever.co/acme.',
  ashby: 'The short board token from the company\'s Ashby URL, e.g. "acme" from jobs.ashbyhq.com/acme.',
  workday: 'The company\'s Workday careers URL, e.g. "acme.wd5.myworkdayjobs.com/External" -- paste it as it appears in your browser\'s address bar.',
};

const PROVIDER_LABELS: Record<string, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workday: 'Workday',
};

export default function SourcesTab() {
  const [rows, setRows] = useState<Source[]>([]);
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState<'neutral' | 'error'>('neutral');
  const [provider, setProvider] = useState('greenhouse');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load(signal?: AbortSignal) {
    const response = await fetch(`${API}/me/search-sources`, { signal });
    if (!response.ok) throw new Error('Could not load your company boards.');
    setRows(await response.json());
  }

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      .catch((error) => {
        if (error instanceof Error && error.name !== 'AbortError') {
          setMessage(error.message);
          setMessageKind('error');
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Capture the form element before the await -- the native event's
    // currentTarget is nulled out once dispatch finishes, so reading it
    // after an await throws "Cannot read properties of null".
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSaving(true);
    setMessage('Saving this board…');
    setMessageKind('neutral');
    try {
      const response = await fetch(`${API}/me/search-sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: form.get('provider'), company_name: form.get('company'), board_key: form.get('board_key'), enabled: true }),
      });
      if (!response.ok) throw new Error('Could not add this company board. Check the address and try again.');
      formElement.reset();
      setProvider('greenhouse');
      await load();
      setMessage('Company board added. Kall can include it in monitored searches.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not add this company board.');
      setMessageKind('error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="Company job boards" className={styles.workspace}>
      <section className={`card ${styles.intro}`}>
        <div className={styles.introCopy}>
          <span className="eyebrow">Company boards</span>
          <h2>Tell Kall which employers to watch.</h2>
          <p>Add a public careers board for a company you care about. Kall checks these alongside broader job search sources and keeps the results in your tracked roles.</p>
        </div>
        <span className="pill">{rows.length} configured</span>
      </section>

      <div className={styles.layout}>
      <article className={`card ${styles.formCard}`}>
        <span className="eyebrow">Add a source</span>
        <h2>Connect a public job board.</h2>
        <p className={styles.description}>Choose the system the employer uses, then copy the identifying part of its careers address.</p>
        <form className="form" onSubmit={submit}>
          <label><span className="muted">Job board system</span><select className="input" name="provider" value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="greenhouse">Greenhouse</option>
            <option value="lever">Lever</option>
            <option value="ashby">Ashby</option>
            <option value="workday">Workday</option>
          </select></label>
          <label><span className="muted">Company name</span><input className="input" name="company" autoComplete="organization" required /></label>
          <label>
            <span className="muted">{provider === 'workday' ? 'Workday careers address' : 'Board key or slug'}</span>
            <input className="input" name="board_key" aria-describedby="board-key-help" autoCapitalize="none" autoCorrect="off" required />
            <small id="board-key-help" className={styles.fieldHelp}>{BOARD_KEY_HINT[provider]}</small>
          </label>
          <button className="button" type="submit" disabled={saving}>{saving ? 'Adding board…' : 'Add company board'}</button>
        </form>
        <p className={`${styles.status} ${messageKind === 'error' ? styles.statusError : ''}`} role={messageKind === 'error' ? 'alert' : 'status'} aria-live="polite">{message}</p>
      </article>
      <article className={`card ${styles.savedCard}`} aria-busy={loading}>
        <span className="eyebrow">Saved sources</span>
        <h2>Your company watchlist.</h2>
        <p className={styles.description}>These boards are available to your scheduled searches. Manage the schedule under Tracked roles.</p>
        {rows.length > 0 ? <ul className={styles.sourceList}>{rows.map((row) => <li className={styles.sourceRow} key={row.id}>
          <div><span className={styles.sourceName}>{row.company_name}</span><span className={styles.sourceKey}>{row.board_key}</span></div>
          <span className={styles.provider}>{PROVIDER_LABELS[row.provider] ?? row.provider}</span>
        </li>)}</ul> : null}
        {!loading && rows.length === 0 ? <p className={styles.empty}>No boards yet. Add the careers page for an employer you would be glad to hear from.</p> : null}
        {loading ? <p className={styles.empty} role="status">Loading your saved boards…</p> : null}
      </article>
      </div>
    </section>
  );
}
