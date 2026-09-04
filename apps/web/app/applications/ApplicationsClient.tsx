'use client';

import { useCallback, useEffect, useState } from 'react';
import AppNav from '../components/AppNav';
import { showToast } from '../components/ToastHost';
import { hideSearchResult, restoreSearchResult } from '../lib/searchResultState';
import styles from './page.module.css';

const API = '/api/kall';
const STAGES = [
  ['preparing', 'Preparing'],
  ['review', 'Needs review'],
  ['approved', 'Approved'],
  ['submitted', 'Submitted'],
  ['interview', 'Interview'],
  ['closed', 'Closed'],
  ['rejected', 'Rejected'],
] as const;

type PipelineItem = {
  id: number; status: string; stage: string; company: string; role: string;
  location?: string | null; job_url?: string | null; is_still_posted?: boolean; match_score?: number | null;
  updated_at?: string | null; submitted_at?: string | null; requires_review: boolean;
  unanswered_question_count: number; sensitive_fields_present: boolean; failure_reason?: string | null;
};
type Stage = { key: string; label: string; count: number; items: PipelineItem[] };
type Pipeline = {
  summary: { total: number; active: number; needs_review: number; submitted: number; best_match?: number | null };
  stages: Stage[]; next_decision?: PipelineItem | null; generated_at: string;
};

function isPipeline(value: unknown): value is Pipeline {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Pipeline>;
  return Boolean(candidate.summary && Array.isArray(candidate.stages));
}

function relativeTime(value?: string | null) {
  if (!value) return 'Recently updated';
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
  return days === 0 ? 'Updated today' : `Updated ${days} day${days === 1 ? '' : 's'} ago`;
}

function detail(item: PipelineItem) {
  if (item.stage === 'rejected') return 'Rejected by employer';
  if (item.failure_reason) return item.failure_reason;
  if (item.requires_review) return 'Review required before approval';
  if (item.stage === 'interview') return 'Interview -- open for prep';
  if (item.submitted_at) return `Submitted ${new Date(item.submitted_at).toLocaleDateString()}`;
  return relativeTime(item.updated_at);
}

export default function ApplicationsClient() {
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const loadPipeline = useCallback(async () => {
    try {
      const response = await fetch(`${API}/me/applications`);
      if (response.status === 401) {setState('signed-out'); return; }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Unable to load applications.');
      if (!isPipeline(data)) throw new Error('The applications API returned an unexpected response.');
      setPipeline(data); setState('ready');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load applications.'); setState('error');
    }
  }, []);

  useEffect(() => { void loadPipeline(); }, [loadPipeline]);

  async function moveApplication(item: PipelineItem, stage: string) {
    if (stage === item.stage) return;
    setBusyId(item.id);
    try {
      const response = await fetch(`${API}/me/applications/${item.id}/stage`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Unable to move application.');
      if ((stage === 'closed' || stage === 'rejected') && item.job_url) {
        hideSearchResult(item.job_url, item.role, 'applied_external');
      }
      showToast(`Application moved to ${STAGES.find(([key]) => key === stage)?.[1] || stage}.`, 'success');
      await loadPipeline();
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Unable to move application.', 'error');
    } finally { setBusyId(null); }
  }

  async function removeApplication(item: PipelineItem) {
    if (!window.confirm(`Remove ${item.role} at ${item.company} from your applications?`)) return;
    setBusyId(item.id);
    try {
      const response = await fetch(`${API}/me/applications/${item.id}`, {
        method: 'DELETE'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Unable to remove application.');
      const jobUrl = typeof data.job_url === 'string' ? data.job_url : item.job_url;
      if (jobUrl) restoreSearchResult(jobUrl);
      showToast('Application removed. The job can appear in search results again.', 'success');
      await loadPipeline();
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Unable to remove application.', 'error');
    } finally { setBusyId(null); }
  }

  if (state === 'loading') return <main className='app-shell'><AppNav current='applications'/><section className={styles.hero}><div><p className='eyebrow'>Applications</p><h1>Loading your applications.</h1></div></section></main>;
  if (state === 'signed-out') return <main className='app-shell'><AppNav current='applications'/><section className={styles.hero}><div><p className='eyebrow'>Applications</p><h1>Sign in to view your applications.</h1></div><a className='button' href='/sign-in'>Sign in</a></section></main>;
  if (state === 'error' || !pipeline) return <main className='app-shell'><AppNav current='applications'/><section className={styles.hero}><div><p className='eyebrow'>Applications</p><h1>Your applications could not be loaded.</h1><p role='alert'>{error}</p></div><button className='button' type='button' onClick={() => void loadPipeline()}>Try again</button></section></main>;

  const next = pipeline.next_decision;
  return <main className='app-shell'>
    <AppNav current='applications'/>
    <section className={styles.hero}><div><p className='eyebrow'>Applications</p><h1>{pipeline.summary.active ? `${pipeline.summary.active} application${pipeline.summary.active === 1 ? '' : 's'} still in progress.` : 'No applications in progress.'}</h1><p>Track what Kall prepared, what still needs your review, and what you submitted.</p></div><a className='button' href='/search'>Search open roles</a></section>
    <section className={styles.summary} aria-label='Application summary'>
      <article><strong>{pipeline.summary.active}</strong><span>Active</span></article><article><strong>{pipeline.summary.needs_review}</strong><span>Needs review</span></article><article><strong>{pipeline.summary.submitted}</strong><span>Submitted</span></article><article><strong>{pipeline.summary.best_match == null ? '—' : `${pipeline.summary.best_match}%`}</strong><span>Best match</span></article>
    </section>
    <section className={styles.pipeline} aria-label='Application pipeline'>
      {pipeline.stages.map(stage => <section className={styles.column} key={stage.key}>
        <header><h2>{stage.label}</h2><span>{stage.count}</span></header>
        <div className={styles.list}>{stage.items.length ? stage.items.map(item => <article className={styles.card} key={item.id} style={{ position: 'relative' }}>
          <button className={styles.remove} type='button' onClick={() => void removeApplication(item)} disabled={busyId === item.id} aria-label={`Remove ${item.role} at ${item.company}`} title='Remove application'>×</button>
          <span className={`${styles.dot} ${item.requires_review ? styles.accent : item.stage === 'submitted' ? styles.success : ''}`} aria-hidden='true'/>
          <p>{item.company}{item.location ? ` · ${item.location}` : ''}</p><h3>{item.role}</h3><span>{detail(item)}{item.match_score == null ? '' : ` · ${item.match_score}% match`}</span>
          {item.is_still_posted === false && <span className={styles.stale} role='status'>This posting may no longer be live</span>}
          <label style={{ display: 'grid', gap: 6, marginTop: 14 }}><span className='muted'>Move to</span><select className='input' value={item.stage} disabled={busyId === item.id} onChange={event => void moveApplication(item, event.target.value)}>{STAGES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <a href={`/applications/${item.id}`}>Open application</a>
        </article>) : <div className={styles.empty}>No applications in this stage.</div>}</div>
      </section>)}
    </section>
    {next ? <section className={`${styles.focus} card`}><div><p className='eyebrow'>Needs your decision</p><h2>Review {next.role} at {next.company}.</h2><p>{detail(next)}.</p></div><a className='button' href={`/applications/${next.id}`}>Review application</a></section> : null}
    <p className={styles.note}>Removing an application makes its job eligible to appear in search again. Closing or rejecting an application keeps the job excluded.</p>
  </main>;
}
