'use client';

import { useEffect, useState } from 'react';
import styles from './page.module.css';

const API = '/api/kall';

type Resume = {
  id: number;
  name: string;
  version: number;
  tags: string[];
  industries: string[];
  target_titles: string[];
  updated_at: string;
  readiness: { score: number; checks: Record<string, boolean> };
};

type Profile = {
  id: number;
  name: string;
  target_titles: string[];
  default_resume_id: number | null;
};

type Studio = { resumes: Resume[]; profiles: Profile[] };

async function responseMessage(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return body.detail || body.message || fallback;
  } catch {
    return fallback;
  }
}

export default function LibraryTab() {
  const [data, setData] = useState<Studio | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch(`${API}/me/resume-studio`);

      if (response.status === 401) {
        window.location.replace('/sign-in');
        return;
      }
      if (!response.ok) {
        throw new Error(await responseMessage(response, 'Unable to load Resume Studio.'));
      }

      setData(await response.json());
      setMessage('');
    } catch (error) {
      setData(null);
      setMessage(error instanceof Error ? error.message : 'Unable to load Resume Studio.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function assign(profileId: number, resumeId: number | null) {
    const response = await fetch(
      `${API}/me/professional-profiles/${profileId}/default-resume`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ resume_id: resumeId }),
      },
    );

    if (response.status === 401) {
      window.location.replace('/sign-in');
      return;
    }

    setMessage(
      response.ok
        ? 'Default resume updated.'
        : await responseMessage(response, 'Unable to update the profile resume.'),
    );
    if (response.ok) await load();
  }

  return (
    <>
      <div className={styles.hero}>
        <div>
          <p className="eyebrow">Resume Studio</p>
          <p>See which resume is current, what each version targets, and which career direction uses it by default.</p>
        </div>
        <a className="button" href="/onboarding">Upload resume</a>
      </div>

      {loading ? (
        <section className={styles.state}>Loading your library…</section>
      ) : message && !data ? (
        <section className={styles.state}>
          <p>{message}</p>
          <button className="button" onClick={() => void load()}>Try again</button>
        </section>
      ) : data ? (
        <>
          <section className={styles.summary}>
            <article><strong>{data.resumes.length}</strong><span>Resumes</span></article>
            <article><strong>{data.profiles.length}</strong><span>Career profiles</span></article>
            <article><strong>{data.resumes.filter((resume) => resume.readiness.score >= 80).length}</strong><span>Ready</span></article>
          </section>
          <section className={styles.grid}>
            <div>
              <div className={styles.heading}><h2>Resume library</h2><span>{message}</span></div>
              {data.resumes.length ? (
                <div className={styles.list}>
                  {data.resumes.map((resume) => (
                    <article className={styles.card} key={resume.id}>
                      <div><p>Version {resume.version}</p><h3>{resume.name}</h3><span>Updated {new Date(resume.updated_at).toLocaleDateString()}</span></div>
                      <div className={styles.score}><strong>{resume.readiness.score}</strong><span>readiness</span></div>
                      <div className={styles.checks}>
                        {Object.entries(resume.readiness.checks).map(([key, complete]) => (
                          <span key={key} className={complete ? styles.complete : ''}>{complete ? '✓' : '○'} {key.replaceAll('_', ' ')}</span>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <section className={styles.state}><h2>No resumes yet.</h2><p>Upload a resume to begin building a reusable document library.</p><a className="button" href="/onboarding">Upload your first resume</a></section>
              )}
            </div>
            <aside className={styles.profiles}>
              <h2>Profile defaults</h2>
              {data.profiles.length ? data.profiles.map((profile) => (
                <article key={profile.id}>
                  <h3>{profile.name}</h3>
                  <p>{profile.target_titles.join(', ') || 'No target titles yet'}</p>
                  <select value={profile.default_resume_id ?? ''} onChange={(event) => void assign(profile.id, event.target.value ? Number(event.target.value) : null)}>
                    <option value="">No default resume</option>
                    {data.resumes.map((resume) => <option value={resume.id} key={resume.id}>{resume.name}</option>)}
                  </select>
                </article>
              )) : <p className="muted">Create a career profile to assign a default resume.</p>}
            </aside>
          </section>
        </>
      ) : null}
    </>
  );
}
