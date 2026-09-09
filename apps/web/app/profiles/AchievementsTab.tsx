'use client';

import { useEffect, useState } from 'react';

const API = '/api/kall';

type Resume = { id: number; name: string };
type Achievement = {
  id: number;
  achievement_text: string;
  metrics: string[];
  skills: string[];
  verification_status: string;
};

export default function AchievementsTab() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [resumeId, setResumeId] = useState('');
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [message, setMessage] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);

  async function load() {
    const headers = { };
    const [resumeResponse, achievementResponse] = await Promise.all([
      fetch(`${API}/me/resumes`, { headers }),
      fetch(`${API}/intelligence/achievements`, { headers }),
    ]);
    if (resumeResponse.ok) {
      const data = await resumeResponse.json();
      setResumes(data);
      if (data[0] && !resumeId) setResumeId(String(data[0].id));
    }
    if (achievementResponse.ok) setAchievements(await achievementResponse.json());
  }

  useEffect(() => { void load(); }, []);

  async function parse() {
    if (!resumeId) return;
    setWarnings([]);
    setMessage('Parsing resume into structured sections and achievement candidates…');
    const response = await fetch(`${API}/intelligence/resumes/${resumeId}/parse`, {
      method: 'POST'
    });
    const data = await response.json();
    const parseWarnings = response.ok && Array.isArray(data.warnings)
      ? data.warnings.filter((warning: unknown): warning is string => typeof warning === 'string' && Boolean(warning.trim()))
      : [];
    setWarnings(parseWarnings);
    setMessage(response.ok
      ? parseWarnings.length
        ? `Parse complete with ${parseWarnings.length} item${parseWarnings.length === 1 ? '' : 's'} to review.`
        : 'Parse complete. No issues found.'
      : data.detail || 'Parse failed.');
    if (response.ok) void load();
  }

  async function verify(id: number, status: 'verified' | 'rejected') {
    const response = await fetch(`${API}/intelligence/achievements/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verification_status: status }),
    });
    if (response.ok) void load();
  }

  return (
    <>
      <section className="card" style={{ marginBottom: 18 }}>
        <h2>Verify the achievements Kall may reuse</h2>
        <p>Review accomplishments extracted from your resumes. Kall excludes them from tailoring until you confirm they are accurate.</p>
        <div className="two">
          <label><span className="muted">Resume to analyze</span><select className="input" value={resumeId} onChange={(event) => setResumeId(event.target.value)}>
            {resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.name}</option>)}
          </select></label>
          <button className="button" type="button" onClick={parse}>Parse selected resume</button>
        </div>
        <p aria-live="polite">{message}</p>
        {warnings.length > 0 && (
          <section className="parse-warnings" aria-labelledby="parse-warning-heading">
            <h3 id="parse-warning-heading">Review these parse notes</h3>
            <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            <p>The resume is still available. Add or clarify the missing information before relying on it for tailoring.</p>
          </section>
        )}
      </section>
      <section className="grid">
        {achievements.map((item) => <article className="card" key={item.id}>
          <span className="pill">{item.verification_status}</span>
          <p style={{ fontSize: 18 }}>{item.achievement_text}</p>
          {item.metrics.length > 0 && <p><b>Metrics:</b> {item.metrics.join(' · ')}</p>}
          {item.skills.length > 0 && <p><b>Skills:</b> {item.skills.join(' · ')}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button" type="button" onClick={() => verify(item.id, 'verified')}>Verify</button>
            <button className="button secondary" type="button" onClick={() => verify(item.id, 'rejected')}>Reject</button>
          </div>
        </article>)}
      </section>
    </>
  );
}
