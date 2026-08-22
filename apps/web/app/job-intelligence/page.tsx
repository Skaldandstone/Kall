'use client';

import { FormEvent, Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AppNav from '../components/AppNav';
import ProfessionalProfileSelect from '../components/ProfessionalProfileSelect';

const API = '/api/kall';

type Score = {
  resume_id: number;
  total_score: number;
  explanation: string[];
  gaps: string[];
};

type Result = {
  scores: Score[];
  coverage: Record<string, { covered: number; total: number }>;
  achievement_matches: Array<{
    achievement_id: number;
    score: number;
    explanation: string[];
  }>;
  selection?: {
    selected_resume_id?: number;
    recommended_resume_id?: number;
  };
};

function validationMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        const issue = item as { msg?: unknown; loc?: unknown };
        const message = typeof issue.msg === 'string' ? issue.msg : '';
        const location = Array.isArray(issue.loc) ? issue.loc.filter((part) => part !== 'path').join(' → ') : '';
        return [location, message].filter(Boolean).join(': ');
      })
      .filter(Boolean);
    if (messages.length > 0) return messages.join(' · ');
  }
  return fallback;
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    return validationMessage(await response.json(), fallback);
  } catch {
    return fallback;
  }
}

export default function JobIntelligencePage() {
  return <Suspense fallback={null}><JobIntelligenceContent /></Suspense>;
}

function JobIntelligenceContent() {
  const params = useSearchParams();
  const [profileId, setProfileId] = useState(params.get('profile') || '');
  const [jobId, setJobId] = useState(params.get('job') || '');
  const [result, setResult] = useState<Result | null>(null);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Arriving from a job's detail view already carries both IDs -- run the
    // analysis immediately instead of making the user press the button again.
    if (params.get('job') && params.get('profile')) void build();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function build(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!profileId) {
      setMessage('Create or select a professional profile first.');
      return;
    }

    const normalizedJobId = jobId.trim();
    if (!/^\d+$/.test(normalizedJobId) || Number(normalizedJobId) < 1) {
      setMessage('Enter a valid numeric job ID greater than zero.');
      return;
    }

    const token = localStorage.getItem('kall_token');
    if (!token) {
      window.location.replace('/login');
      return;
    }

    setIsLoading(true);
    setResult(null);
    setMessage('Preparing match intelligence…');

    try {
      const run = await fetch(`${API}/jobs/${normalizedJobId}/intelligence/${profileId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (run.status === 401) {
        localStorage.removeItem('kall_token');
        window.location.replace('/login');
        return;
      }
      if (!run.ok) {
        setMessage(await responseMessage(run, 'Unable to build intelligence.'));
        return;
      }

      const response = await fetch(`${API}/jobs/${normalizedJobId}/intelligence/${profileId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 401) {
        localStorage.removeItem('kall_token');
        window.location.replace('/login');
        return;
      }
      if (!response.ok) {
        setMessage(await responseMessage(response, 'The analysis ran, but the results could not be loaded.'));
        return;
      }

      const payload = await response.json();
      if (!payload || !Array.isArray(payload.scores) || typeof payload.coverage !== 'object') {
        setMessage('The API returned an incomplete intelligence result.');
        return;
      }
      setResult(payload);
      setMessage('Analysis complete.');
    } catch {
      setMessage('Kall could not reach the API. Check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }

  async function selectResume(resumeId: number) {
    const token = localStorage.getItem('kall_token');
    if (!token) {
      window.location.replace('/login');
      return;
    }
    const response = await fetch(`${API}/jobs/${jobId.trim()}/intelligence/${profileId}/selection`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ resume_id: resumeId }),
    });

    setMessage(response.ok ? `Resume ${resumeId} is now selected for this opportunity.` : await responseMessage(response, 'Kall could not save the resume selection.'));
  }

  return (
    <main className="app-shell">
      <AppNav current="opportunities" />

      <section className="hero" style={{ paddingTop: 8, paddingBottom: 42 }}>
        <span className="eyebrow">Opportunity review</span>
        <h1 style={{ fontSize: 'clamp(44px, 7vw, 76px)' }}>Compare your experience to the role.</h1>
        <p>Kall evaluates each resume against the opportunity, explains the evidence behind the score, and keeps the final selection in your control.</p>
      </section>

      <section className="card" aria-labelledby="analysis-heading">
        <h2 id="analysis-heading">Build match intelligence</h2>
        <p style={{ marginBottom: 20 }}>Select an existing job and professional profile. Kall will compare all eligible resumes and verified achievements.</p>
        <form className="form" onSubmit={build}>
          <div className="two">
            <label>
              <span className="muted">Job ID</span>
              <input className="input" name="job_id" inputMode="numeric" pattern="[0-9]+" min="1" value={jobId} onChange={(event) => setJobId(event.target.value)} placeholder="e.g. 128" required />
            </label>
            <ProfessionalProfileSelect value={profileId} onChange={setProfileId} />
          </div>
          <button className="button" disabled={isLoading || !profileId}>{isLoading ? 'Preparing analysis…' : 'Build match intelligence'}</button>
        </form>
        <p className="notice" aria-live="polite" style={{ marginTop: 16 }}>{message}</p>
      </section>

      {result && (
        <div className="stack" style={{ marginTop: 16 }}>
          <section className="grid" aria-label="Coverage summary">
            {Object.entries(result.coverage || {}).map(([key, value]) => (
              <article className="card" key={key}>
                <h3>{key.replaceAll('_', ' ')}</h3>
                <div className="metric"><strong>{value.covered}</strong><span className="muted">of {value.total}</span></div>
                <p>profile signals covered</p>
              </article>
            ))}
          </section>

          <section aria-labelledby="resume-ranking-heading">
            <div className="section-heading">
              <div><span className="eyebrow">Resume ranking</span><h2 id="resume-ranking-heading" style={{ marginTop: 14 }}>Evidence, not guesswork.</h2></div>
              <p>Scores are accompanied by positive evidence and visible gaps so you can review the recommendation before acting.</p>
            </div>
            <div className="stack">
              {result.scores.map((score, index) => (
                <article className="card" key={score.resume_id}>
                  <span className="pill">{index === 0 ? 'Recommended' : 'Candidate'}</span>
                  <div className="metric"><strong>{score.total_score}%</strong><span className="muted">Resume {score.resume_id}</span></div>
                  <p>{score.explanation.join(' · ') || 'No positive evidence is available yet.'}</p>
                  <p style={{ marginTop: 14 }}><strong style={{ color: 'var(--text)' }}>Gaps:</strong> {score.gaps.join(', ') || 'None detected'}</p>
                  <button className="button secondary" style={{ marginTop: 20 }} onClick={() => selectResume(score.resume_id)}>Use this resume</button>
                </article>
              ))}
            </div>
          </section>

          <section className="card">
            <span className="eyebrow">Verified evidence</span>
            <div className="metric"><strong>{result.achievement_matches.length}</strong><span className="muted">relevant achievements</span></div>
            <p>Only verified, accepted achievements are included in this match. Rejected achievements remain excluded.</p>
          </section>
        </div>
      )}
    </main>
  );
}
