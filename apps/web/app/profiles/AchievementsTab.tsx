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
    setMessage('Parsing resume into structured sections and achievement candidates…');
    const response = await fetch(`${API}/intelligence/resumes/${resumeId}/parse`, {
      method: 'POST'
    });
    const data = await response.json();
    setMessage(response.ok ? `Parse complete. ${data.warnings.length} warning(s).` : data.detail || 'Parse failed.');
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
        <h1>Build your verified achievement library</h1>
        <p>Kall extracts candidates from uploaded resumes. Nothing is approved for tailoring until you verify it.</p>
        <div className="two">
          <select className="input" value={resumeId} onChange={(event) => setResumeId(event.target.value)}>
            {resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.name}</option>)}
          </select>
          <button className="button" onClick={parse}>Parse selected resume</button>
        </div>
        <p>{message}</p>
      </section>
      <section className="grid">
        {achievements.map((item) => <article className="card" key={item.id}>
          <span className="pill">{item.verification_status}</span>
          <p style={{ fontSize: 18 }}>{item.achievement_text}</p>
          {item.metrics.length > 0 && <p><b>Metrics:</b> {item.metrics.join(' · ')}</p>}
          {item.skills.length > 0 && <p><b>Skills:</b> {item.skills.join(' · ')}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button" onClick={() => verify(item.id, 'verified')}>Verify</button>
            <button className="button secondary" onClick={() => verify(item.id, 'rejected')}>Reject</button>
          </div>
        </article>)}
      </section>
    </>
  );
}
