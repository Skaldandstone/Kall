'use client';

import { useState } from 'react';
import ChipsInput from '../../components/ChipsInput';
import ChipsToggle from '../../components/ChipsToggle';
import type { SharedSearchView } from './page';

const WORK_TYPE_OPTIONS = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'on_site', label: 'On-site' },
];

function IntakeForm({ slug }: { slug: string }) {
  const [titles, setTitles] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [statesRegions, setStatesRegions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SharedSearchView | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const form = new FormData(event.currentTarget);
      const workTypes = String(form.get('work_types') || '').split(',').filter(Boolean);
      const response = await fetch(`/api/kall/shared-searches/${slug}/criteria`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          criteria: {
            target_titles: titles,
            industries,
            include_keywords: keywords,
            countries,
            states_regions: statesRegions,
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
        <ChipsInput
          label="Job titles you're looking for"
          placeholder="Retail Associate, Store Manager"
          helpText="Press Enter to add a title. Include close variants — job boards phrase the same role differently."
          value={titles}
          onChange={setTitles}
          required
        />
        <ChipsInput
          label="Industries"
          placeholder="Software, Healthcare, Retail"
          value={industries}
          onChange={setIndustries}
        />
        <ChipsInput
          label="Skills to search for"
          placeholder="C++, DX12, Vulkan"
          helpText="Specific tools, languages, or technologies — as specific as you like."
          value={keywords}
          onChange={setKeywords}
        />
        <ChipsInput
          label="Countries"
          placeholder="United States"
          value={countries}
          onChange={setCountries}
        />
        <ChipsInput
          label="States / regions"
          placeholder="Washington, Oregon"
          value={statesRegions}
          onChange={setStatesRegions}
        />
        <ChipsToggle name="work_types" label="Work style" options={WORK_TYPE_OPTIONS} defaultValue={['remote']} />
        {error && <p className="notice">{error}</p>}
        <button className="button" type="submit" disabled={busy || titles.length === 0}>
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
