'use client';

import { useState } from 'react';
import type { SharedSearchView } from './page';

const WORK_TYPE_OPTIONS = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'on_site', label: 'On-site' },
];

const csv = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);

function IntakeForm({ slug }: { slug: string }) {
  const [titles, setTitles] = useState('');
  const [countries, setCountries] = useState('');
  const [statesRegions, setStatesRegions] = useState('');
  const [workTypes, setWorkTypes] = useState<string[]>(['remote']);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SharedSearchView | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/kall/shared-searches/${slug}/criteria`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          criteria: {
            target_titles: csv(titles),
            countries: csv(countries),
            states_regions: csv(statesRegions),
            work_types: workTypes,
          },
        }),
      });
      if (!response.ok) {
        setError('This link is no longer accepting answers. Ask for a new one.');
        return;
      }
      setResult(await response.json());
    } finally {
      setBusy(false);
    }
  }

  if (result) return <ResultsView slug={slug} view={result} />;

  return (
    <section className="card">
      <span className="eyebrow">Job search, made easy</span>
      <h1 style={{ marginTop: 16 }}>Someone wants to help you find a job.</h1>
      <p>Answer a few quick questions and get a batch of real openings that match — no account needed.</p>
      <form className="stack" style={{ marginTop: 16 }} onSubmit={submit}>
        <label>
          Job titles you&apos;re looking for
          <input className="input" placeholder="Retail Associate, Store Manager" value={titles} onChange={(e) => setTitles(e.target.value)} required />
        </label>
        <label>
          Countries
          <input className="input" placeholder="United States" value={countries} onChange={(e) => setCountries(e.target.value)} />
        </label>
        <label>
          States / regions
          <input className="input" placeholder="Washington, Oregon" value={statesRegions} onChange={(e) => setStatesRegions(e.target.value)} />
        </label>
        <fieldset style={{ border: 0, padding: 0 }}>
          <legend>Work style</legend>
          <div style={{ display: 'flex', gap: 10 }}>
            {WORK_TYPE_OPTIONS.map((option) => {
              const active = workTypes.includes(option.value);
              return (
                <button
                  type="button"
                  key={option.value}
                  className={active ? 'button' : 'button ghost'}
                  onClick={() =>
                    setWorkTypes((current) =>
                      active ? current.filter((v) => v !== option.value) : [...current, option.value],
                    )
                  }
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </fieldset>
        {error && <p className="notice">{error}</p>}
        <button className="button" type="submit" disabled={busy || !titles.trim()}>
          {busy ? 'Finding matches…' : 'Show me matches'}
        </button>
      </form>
    </section>
  );
}

function ResultsView({ slug, view }: { slug: string; view: SharedSearchView }) {
  const [current, setCurrent] = useState(view);
  const [refreshing, setRefreshing] = useState(false);
  const results = current.status === 'active' ? current.results : [];
  const lastRefreshed = current.status === 'active' ? current.last_refreshed_at : null;

  async function refresh() {
    setRefreshing(true);
    try {
      const response = await fetch(`/api/kall/shared-searches/${slug}/refresh`, { method: 'POST' });
      if (response.ok) setCurrent(await response.json());
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="stack">
      <div className="card">
        <span className="eyebrow">Job matches shared with you</span>
        <h1 style={{ marginTop: 16 }}>{results.length} open role{results.length === 1 ? '' : 's'} right now</h1>
        <p className="notice">
          {lastRefreshed ? `Last refreshed ${new Date(lastRefreshed).toLocaleString()}.` : ''} These are real, live
          postings — open one to see the full listing and apply directly with the employer. Neither Kall nor whoever
          shared this link can apply for you.
        </p>
        <button className="button secondary" onClick={() => void refresh()} disabled={refreshing} style={{ marginTop: 8 }}>
          {refreshing ? 'Refreshing…' : 'Refresh matches'}
        </button>
      </div>
      <div className="stack">
        {results.map((job, index) => (
          <article className="card" key={`${job.url}-${index}`}>
            <h3 style={{ margin: 0 }}>{job.title}</h3>
            <p className="notice" style={{ margin: '4px 0' }}>
              {job.company}
              {job.location ? ` · ${job.location}` : ''}
            </p>
            {job.strengths.length > 0 && (
              <ul style={{ margin: '8px 0', paddingLeft: 18 }}>
                {job.strengths.map((strength, i) => (
                  <li key={i}>{strength}</li>
                ))}
              </ul>
            )}
            <a className="button" href={job.url} target="_blank" rel="noopener noreferrer nofollow">
              View posting
            </a>
          </article>
        ))}
        {results.length === 0 && <p className="notice">No matches yet — try refreshing in a bit, or ask for a new link with broader criteria.</p>}
      </div>
      <div className="card">
        <p>Want to track these, get new matches automatically, and build a full application pipeline?</p>
        <a className="button" href={`/onboarding?from=${slug}`}>
          Create a free Kall account
        </a>
      </div>
    </section>
  );
}

export default function FriendDigestClient({ slug, initial }: { slug: string; initial: SharedSearchView }) {
  if (initial.status === 'awaiting_input') return <IntakeForm slug={slug} />;
  return <ResultsView slug={slug} view={initial} />;
}
