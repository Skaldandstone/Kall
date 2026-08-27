'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import ProfessionalProfileSelect from '../components/ProfessionalProfileSelect';

const API = '/api/kall';

type JobResult = {
  match_id: number;
  job_id: number;
  score: number;
  recommendation: string;
  strengths: string[];
  gaps: string[];
  company: string;
  title: string;
  location?: string | null;
  work_type?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  url: string;
  source: string;
};

type SearchRun = {
  id: number;
  professional_profile_id: number;
  started_at: string;
  completed_at?: string | null;
  providers_requested: string[];
  ats_search_query?: string | null;
  jobs_collected: number;
  jobs_created: number;
  matches_created: number;
  errors: string[];
  status: string;
};

type Schedule = {
  id: number;
  professional_profile_id: number;
  cadence: string;
  timezone: string;
  run_at_local: string;
  enabled: boolean;
  max_posting_age_days: number;
  next_run_at?: string | null;
  last_run_at?: string | null;
};

type Opportunity = {
  id: number;
  professional_profile_id: number;
  job_id: number;
  state: string;
  match_score: number;
  notes?: string;
  last_seen_at: string;
};

async function responseMessage(response: Response, fallback: string) {
  try {
    const payload = await response.json();
    return payload.detail || payload.message || fallback;
  } catch {
    return fallback;
  }
}

export default function DiscoveryTab() {
  const [profileId, setProfileId] = useState('');
  const [minimumScore, setMinimumScore] = useState(35);
  const [results, setResults] = useState<JobResult[]>([]);
  const [runs, setRuns] = useState<SearchRun[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [message, setMessage] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);


  const authenticatedFetch = useCallback(async (url: string, init: RequestInit = {}) => {
    const response = await fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        },
    });
    if (response.status === 401) {
      window.location.replace('/sign-in');
      throw new Error('Session expired');
    }
    return response;
  }, []);

  const loadResults = useCallback(async (selectedProfile = profileId, score = minimumScore) => {
    if (!selectedProfile) {
      setResults([]);
      return;
    }
    const response = await authenticatedFetch(
      `${API}/jobs/feed?professional_profile_id=${selectedProfile}&min_score=${score}`,
    );
    if (!response.ok) throw new Error(await responseMessage(response, 'Unable to load search results.'));
    setResults(await response.json());
  }, [authenticatedFetch, minimumScore, profileId]);

  const loadRuns = useCallback(async () => {
    const response = await authenticatedFetch(`${API}/discovery/runs`);
    if (!response.ok) throw new Error(await responseMessage(response, 'Unable to load search history.'));
    setRuns(await response.json());
  }, [authenticatedFetch]);

  const loadSchedules = useCallback(async () => {
    const response = await authenticatedFetch(`${API}/discovery/schedules`);
    if (!response.ok) throw new Error(await responseMessage(response, 'Unable to load schedules.'));
    setSchedules(await response.json());
  }, [authenticatedFetch]);

  const loadOpportunities = useCallback(async () => {
    const response = await authenticatedFetch(`${API}/opportunities`);
    if (!response.ok) throw new Error(await responseMessage(response, 'Unable to load opportunity inbox.'));
    setOpportunities(await response.json());
  }, [authenticatedFetch]);

  useEffect(() => {
    let cancelled = false;
    async function initialLoad() {
      try {
        await Promise.all([loadRuns(), loadSchedules(), loadOpportunities()]);
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Unable to load opportunities.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void initialLoad();
    return () => { cancelled = true; };
  }, [loadOpportunities, loadRuns, loadSchedules]);

  useEffect(() => {
    if (!profileId) return;
    void loadResults(profileId, minimumScore).catch((error) => {
      setMessage(error instanceof Error ? error.message : 'Unable to load search results.');
    });
  }, [loadResults, minimumScore, profileId]);

  const selectedSchedule = useMemo(
    () => schedules.find((schedule) => String(schedule.professional_profile_id) === profileId),
    [profileId, schedules],
  );

  const selectedRuns = useMemo(
    () => runs.filter((run) => String(run.professional_profile_id) === profileId).slice(0, 8),
    [profileId, runs],
  );

  const selectedOpportunities = useMemo(
    () => opportunities.filter((item) => !profileId || String(item.professional_profile_id) === profileId),
    [opportunities, profileId],
  );

  async function searchNow() {
    if (!profileId) {
      setMessage('Create or select a professional profile first.');
      return;
    }
    setIsSearching(true);
    setMessage('Searching your configured company boards…');
    try {
      const response = await authenticatedFetch(`${API}/discovery/run/${profileId}`, { method: 'POST' });
      if (!response.ok) throw new Error(await responseMessage(response, 'Unable to run discovery.'));
      const run: SearchRun = await response.json();
      await Promise.all([loadResults(profileId, minimumScore), loadRuns(), loadOpportunities()]);
      setMessage(
        `Search complete: ${run.jobs_collected} collected, ${run.jobs_created} new, ${run.matches_created} matched.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to run discovery.');
    } finally {
      setIsSearching(false);
    }
  }

  async function saveSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileId) {
      setMessage('Create or select a professional profile first.');
      return;
    }
    setIsSavingSchedule(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await authenticatedFetch(`${API}/discovery/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          professional_profile_id: Number(profileId),
          cadence: form.get('cadence'),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          hour_local: Number(form.get('hour_local')),
          max_posting_age_days: Number(form.get('age_days')),
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, 'Unable to save schedule.'));
      await loadSchedules();
      setMessage('Automatic discovery schedule saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save schedule.');
    } finally {
      setIsSavingSchedule(false);
    }
  }

  async function changeState(id: number, state: string) {
    try {
      const response = await authenticatedFetch(`${API}/opportunities/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, 'Unable to update opportunity.'));
      await loadOpportunities();
      setMessage('Opportunity updated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update opportunity.');
    }
  }

  function formatSalary(result: JobResult) {
    if (!result.salary_min && !result.salary_max) return 'Salary not listed';
    const low = result.salary_min || result.salary_max || 0;
    const high = result.salary_max || result.salary_min || 0;
    return `$${low.toLocaleString()}${high !== low ? `–$${high.toLocaleString()}` : ''}`;
  }

  return (
    <>
      <section className="card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Search controls</span>
            <h2 style={{ marginTop: 14 }}>Find current matches</h2>
          </div>
          <p>Search criteria come from the selected professional profile and its configured company boards.</p>
        </div>
        <div className="two">
          <ProfessionalProfileSelect value={profileId} onChange={setProfileId} />
          <label>
            <span className="muted">Minimum match score</span>
            <select className="input" value={minimumScore} onChange={(event) => setMinimumScore(Number(event.target.value))}>
              <option value={0}>Show every match</option>
              <option value={35}>35% and above</option>
              <option value={55}>55% and above</option>
              <option value={70}>70% and above</option>
              <option value={85}>85% and above</option>
            </select>
          </label>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 18 }}>
          <button className="button" type="button" onClick={searchNow} disabled={!profileId || isSearching}>
            {isSearching ? 'Searching…' : 'Search now'}
          </button>
          <a className="button secondary" href="/search?tab=sources">Manage search sources</a>
          <a className="button ghost" href="/profiles">Edit professional profiles</a>
        </div>
        <p className="notice" aria-live="polite" style={{ marginTop: 16 }}>{message}</p>
      </section>

      <section style={{ marginTop: 32 }}>
        <div className="section-heading">
          <div><span className="eyebrow">Results</span><h2 style={{ marginTop: 14 }}>Matched opportunities</h2></div>
          <p>{isLoading ? 'Loading…' : `${results.length} role${results.length === 1 ? '' : 's'} at or above ${minimumScore}% match.`}</p>
        </div>
        <div className="stack">
          {results.map((result) => (
            <article className="card" key={result.match_id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
                <div>
                  <span className="pill">{result.score}% match · {result.recommendation}</span>
                  <h2 style={{ marginTop: 16, marginBottom: 6 }}>{result.title}</h2>
                  <p><strong style={{ color: 'var(--text)' }}>{result.company}</strong></p>
                </div>
                <p style={{ textAlign: 'right' }}>
                  {result.location || 'Location not listed'}<br />
                  {result.work_type || 'Work type unknown'} · {formatSalary(result)}
                </p>
              </div>
              {result.strengths.length > 0 && <p style={{ marginTop: 18 }}><strong style={{ color: 'var(--text)' }}>Strengths:</strong> {result.strengths.slice(0, 4).join(' · ')}</p>}
              {result.gaps.length > 0 && <p style={{ marginTop: 10 }}><strong style={{ color: 'var(--text)' }}>Gaps:</strong> {result.gaps.slice(0, 4).join(' · ')}</p>}
              <p className="muted" style={{ marginTop: 10 }}>Source: {result.source}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 20 }}>
                <a className="button secondary" href={result.url} target="_blank" rel="noreferrer">View role</a>
                <a className="button" href={`/applications/new?job=${result.job_id}&profile=${profileId}`}>Prepare application</a>
                <a className="button ghost" href={`/job-intelligence?job=${result.job_id}&profile=${profileId}`}>Analyze match</a>
              </div>
            </article>
          ))}
          {!isLoading && profileId && results.length === 0 && (
            <article className="card">
              <h2>No matching results yet</h2>
              <p>Run Search Now, lower the minimum score, or add company boards under Search Sources.</p>
            </article>
          )}
        </div>
      </section>

      <section className="card" style={{ marginTop: 32 }}>
        <div className="section-heading">
          <div><span className="eyebrow">Automatic search</span><h2 style={{ marginTop: 14 }}>Keep this profile monitored</h2></div>
          <p>
            {selectedSchedule
              ? `Current schedule: ${selectedSchedule.cadence} at ${selectedSchedule.run_at_local.slice(0, 5)}.`
              : 'No automatic search is configured for this profile.'}
          </p>
        </div>
        <form className="form" onSubmit={saveSchedule} key={selectedSchedule?.id || profileId || 'empty'}>
          <div className="two">
            <label>
              <span className="muted">Cadence</span>
              <select className="input" name="cadence" defaultValue={selectedSchedule?.cadence || 'daily'}>
                <option value="daily">Daily</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekly">Weekly</option>
              </select>
            </label>
            <label>
              <span className="muted">Local hour</span>
              <input className="input" name="hour_local" type="number" min="0" max="23" defaultValue={selectedSchedule ? Number(selectedSchedule.run_at_local.slice(0, 2)) : 8} />
            </label>
          </div>
          <label>
            <span className="muted">Maximum posting age in days</span>
            <input className="input" name="age_days" type="number" min="1" max="90" defaultValue={selectedSchedule?.max_posting_age_days || 30} />
          </label>
          <button className="button" disabled={!profileId || isSavingSchedule}>
            {isSavingSchedule ? 'Saving…' : selectedSchedule ? 'Update schedule' : 'Save schedule'}
          </button>
        </form>
        {selectedSchedule && (
          <div className="grid" style={{ marginTop: 22 }}>
            <article className="card"><h3>Last automatic run</h3><p>{selectedSchedule.last_run_at ? new Date(selectedSchedule.last_run_at).toLocaleString() : 'Not run yet'}</p></article>
            <article className="card"><h3>Next automatic run</h3><p>{selectedSchedule.next_run_at ? new Date(selectedSchedule.next_run_at).toLocaleString() : 'Pending scheduler'}</p></article>
            <article className="card"><h3>Timezone</h3><p>{selectedSchedule.timezone}</p></article>
          </div>
        )}
      </section>

      <section style={{ marginTop: 32 }}>
        <div className="section-heading">
          <div><span className="eyebrow">Search history</span><h2 style={{ marginTop: 14 }}>Recent discovery runs</h2></div>
          <p>See what each immediate or scheduled run collected and matched.</p>
        </div>
        <div className="stack">
          {selectedRuns.map((run) => (
            <article className="card" key={run.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div><span className="pill">{run.status}</span><h2 style={{ marginTop: 14 }}>{new Date(run.started_at).toLocaleString()}</h2></div>
                <p>{run.providers_requested.join(', ') || 'Configured sources'}</p>
              </div>
              <div className="grid" style={{ marginTop: 18 }}>
                <div><div className="metric"><strong>{run.jobs_collected}</strong></div><p>collected</p></div>
                <div><div className="metric"><strong>{run.jobs_created}</strong></div><p>new jobs</p></div>
                <div><div className="metric"><strong>{run.matches_created}</strong></div><p>matches</p></div>
              </div>
              {run.ats_search_query && (
                <p style={{ marginTop: 16 }}>
                  <strong style={{ color: 'var(--text)' }}>Hidden-market search:</strong>{' '}
                  <code style={{ fontSize: 13 }}>{run.ats_search_query}</code>
                </p>
              )}
              {run.errors.length > 0 && <p style={{ marginTop: 16 }}><strong style={{ color: 'var(--text)' }}>Issues:</strong> {run.errors.join(' · ')}</p>}
            </article>
          ))}
          {profileId && selectedRuns.length === 0 && <article className="card"><h2>No search history yet</h2><p>Run Search Now to create the first discovery record.</p></article>}
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <div className="section-heading">
          <div><span className="eyebrow">Inbox</span><h2 style={{ marginTop: 14 }}>Saved workflow state</h2></div>
          <p>Review, save, apply, or dismiss opportunities that Kall is actively tracking.</p>
        </div>
        <div className="stack">
          {selectedOpportunities.map((item) => (
            <article className="card" key={item.id}>
              <span className="pill">{item.state.replaceAll('_', ' ')}</span>
              <div className="metric"><strong>{item.match_score}%</strong><span className="muted">Job {item.job_id}</span></div>
              <p>Last seen {new Date(item.last_seen_at).toLocaleDateString()}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 20 }}>
                <button className="button secondary" onClick={() => changeState(item.id, 'saved')}>Save</button>
                <button className="button secondary" onClick={() => changeState(item.id, 'reviewing')}>Review</button>
                <button className="button" onClick={() => changeState(item.id, 'apply')}>Apply</button>
                <button className="button ghost" onClick={() => changeState(item.id, 'not_interested')}>Dismiss</button>
              </div>
            </article>
          ))}
          {!isLoading && selectedOpportunities.length === 0 && <article className="card"><h2>No tracked opportunities yet</h2><p>Run a search to begin filling the inbox.</p></article>}
        </div>
      </section>
    </>
  );
}
