'use client';

import { useEffect, useState } from 'react';
import AppNav from '../components/AppNav';
import { showToast } from '../components/ToastHost';
import styles from './page.module.css';

const API = '/api/kall';

type Opportunity = {
  job_id: number;
  company: string;
  title: string;
  location?: string | null;
  work_type?: string | null;
  score: number;
  recommendation: string;
  strengths: string[];
  gaps: string[];
};

type Dimension = { label: string; score: number; explanation: string };
type Brief = {
  generated_at: string;
  user: { preferred_name: string };
  focus: { kind: string; title: string; detail: string; href: string };
  opportunities: Opportunity[];
  career_health: { score: number; dimensions: Dimension[] };
  applications: { total: number; active: number; by_status: Record<string, number> };
  resumes: { total: number; default_resume_id?: number | null };
};

function formatDay(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(value));
}

async function responseMessage(response: Response) {
  try {
    const body = await response.json();
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.detail)) {
      return body.detail.map((item: { msg?: string }) => item.msg).filter(Boolean).join(' · ');
    }
  } catch {
    // Use the status-based fallback below for non-JSON responses.
  }
  return `Unable to prepare your brief (${response.status}).`;
}

export default function MorningBriefClient() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [message, setMessage] = useState('Preparing your brief…');
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setMessage('Preparing your brief…');
    fetch(`${API}/me/morning-brief`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.replace('/sign-in');
          throw new Error('Your session expired. Please sign in again.');
        }
        if (!response.ok) throw new Error(await responseMessage(response));
        return response.json() as Promise<Brief>;
      })
      .then((data) => {
        setBrief(data);
        setMessage('');
        setLoading(false);
      })
      .catch((error: Error) => {
        if (error.name === 'AbortError') return;
        const nextMessage = error.message === 'Failed to fetch'
          ? 'Kall could not reach the Morning Brief service. Please try again.'
          : error.message;
        setMessage(nextMessage);
        setLoading(false);
        showToast(nextMessage, 'error');
      });

    return () => controller.abort();
  }, [attempt]);

  if (!brief) {
    return (
      <main className={styles.shell}>
        <AppNav current="brief" />
        <section className={styles.hero}>
          <p className="eyebrow">Morning Brief</p>
          <div className={styles.heroGrid}>
            <div>
              <h1>Your career, prepared quietly.</h1>
              <p className={styles.lede} role={loading ? 'status' : 'alert'}>{message}</p>
            </div>
            <aside className={styles.summary}>
              <span>Next step</span>
              <strong>{loading ? 'Kall is gathering your saved activity.' : 'Your saved work is still available.'}</strong>
              {!loading && <p>You can search for a role or open your career profile while the brief is unavailable.</p>}
            </aside>
          </div>
        </section>
        {!loading && <div className={styles.actions} style={{ marginTop: 24 }}>
          <button className="button" type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
          <a className="button secondary" href="/search">Search for a job</a>
          <a className="button secondary" href="/profiles">Open career profile</a>
        </div>}
      </main>
    );
  }

  const opportunityCount = brief.opportunities.length;
  const healthLabel = brief.career_health.score >= 80 ? 'Strong' : brief.career_health.score >= 60 ? 'Developing' : 'Needs attention';

  return (
    <main className={styles.shell}>
      <AppNav current="brief" />
      <section className={styles.hero}>
        <p className="eyebrow">{formatDay(brief.generated_at)}</p>
        <div className={styles.heroGrid}>
          <div>
            <h1>Good morning, {brief.user.preferred_name}.</h1>
            <p className={styles.lede}>
              {opportunityCount
                ? `${opportunityCount} ${opportunityCount === 1 ? 'opportunity deserves' : 'opportunities deserve'} your attention.`
                : 'Your next career decision is ready.'}
            </p>
          </div>
          <aside className={styles.summary}>
            <span>Daily focus</span>
            <strong>{brief.focus.title}</strong>
            <p>{brief.focus.detail}</p>
            <a className="text-link" href={brief.focus.href}>Continue</a>
          </aside>
        </div>
      </section>

      <section className={styles.grid}>
        <div className={styles.main}>
          <div className={styles.heading}>
            <div><p className="eyebrow">Grounded in your data</p><h2>Top opportunities</h2></div>
            <a className="text-link" href="/search">View all opportunities</a>
          </div>

          {brief.opportunities.length ? (
            <div className={styles.list}>
              {brief.opportunities.map((opportunity, index) => (
                <article className={styles.row} key={opportunity.job_id}>
                  <div className={styles.rank}>0{index + 1}</div>
                  <div>
                    <div className={styles.titleRow}>
                      <div>
                        <h3>{opportunity.title}</h3>
                        <p>{opportunity.company}{opportunity.location ? ` · ${opportunity.location}` : ''}</p>
                      </div>
                      <span className={styles.score}>{opportunity.score}% match</span>
                    </div>
                    <p className={styles.reason}>
                      {opportunity.strengths.length
                        ? opportunity.strengths.join(' · ')
                        : 'This match is based on your active professional profile.'}
                    </p>
                    {opportunity.gaps.length > 0 && <p className={styles.reason}>Review: {opportunity.gaps.join(' · ')}</p>}
                    <div className={styles.actions}>
                      <a className="button" href={`/job-intelligence?job=${opportunity.job_id}`}>Review analysis</a>
                      <a className="button secondary" href="/search?tab=discovery">Open tracked opportunities</a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <article className={styles.panel}>
              <h2>No evaluated opportunities yet.</h2>
              <p>Run a search and evaluate a match. Kall will place the strongest verified results here.</p>
              <a className="text-link" href="/search">Start an opportunity search</a>
            </article>
          )}

          <article className={`${styles.panel} ${styles.interview}`}>
            <div>
              <p className="eyebrow">Applications</p>
              <h2>{brief.applications.active} active {brief.applications.active === 1 ? 'application' : 'applications'}.</h2>
              <p>{brief.applications.total ? 'Review progress and the next decision in your pipeline.' : 'No applications are currently tracked.'}</p>
            </div>
            <a className="button secondary" href="/applications">Open applications</a>
          </article>
        </div>

        <aside className={styles.side}>
          <article className={styles.panel}>
            <p className="eyebrow">Career health</p>
            <div className={styles.healthScore}><strong>{brief.career_health.score}</strong><span>{healthLabel}</span></div>
            <div className={styles.healthList}>
              {brief.career_health.dimensions.map((dimension) => (
                <div className={styles.healthItem} key={dimension.label}>
                  <div className={styles.healthLabel}><span>{dimension.label}</span><strong>{dimension.score}%</strong></div>
                  <div className={styles.track}><span style={{ width: `${dimension.score}%` }} /></div>
                  <p>{dimension.explanation}</p>
                </div>
              ))}
            </div>
          </article>

          <article className={styles.panel}>
            <p className="eyebrow">Resume readiness</p>
            <h2>{brief.resumes.total ? `${brief.resumes.total} ${brief.resumes.total === 1 ? 'resume' : 'resumes'} available.` : 'No resume uploaded yet.'}</h2>
            <p>{brief.resumes.default_resume_id ? 'A default resume is selected for application preparation.' : 'Select a default resume to make preparation faster and more consistent.'}</p>
            <a className="text-link" href={brief.resumes.total ? '/resumes?tab=intelligence' : '/resumes'}>{brief.resumes.total ? 'Review resume evidence' : 'Upload your first resume'}</a>
          </article>

          <p className={styles.note}>This brief uses stored Kall facts and deterministic heuristics. It does not invent activity.</p>
        </aside>
      </section>
    </main>
  );
}
