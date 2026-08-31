'use client';

import { useCallback, useEffect, useState } from 'react';
import { showToast } from '../components/ToastHost';

const API = '/api/kall';

type Recommendation = { id: string; section: string; title: string; reason: string; current_text: string; proposed_text: string; confidence: number };
type ResumeInsight = { id: number; name: string; version: number; is_default: boolean; tags: string[]; industries: string[]; target_titles: string[]; readiness_score: number; strengths: string[]; gaps: string[]; aligned_profile_titles: string[]; text_character_count: number };
type Dashboard = { summary: { resume_count: number; profile_count: number; best_resume_id?: number | null; best_score?: number | null; default_resume_id?: number | null }; resumes: ResumeInsight[]; profile_titles: string[] };

async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  if (response.status === 401) {window.location.replace('/sign-in'); throw new Error('signed-out'); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'The request could not be completed.');
  return body;
}

export default function IntelligenceTab() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [removeId, setRemoveId] = useState<number | null>(null);
  const [recommendations, setRecommendations] = useState<Record<number, Recommendation[]>>({});
  const [selected, setSelected] = useState<Record<number, string[]>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api('/me/resume-intelligence')); }
    catch (error) { if ((error as Error).message !== 'signed-out') showToast((error as Error).message, 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function removeResume(id: number) {
    setBusyId(id);
    try {
      await api(`/me/resumes/${id}`, { method: 'DELETE' });
      setRemoveId(null);
      showToast('Resume removed.', 'success');
      await load();
    } catch (error) { showToast((error as Error).message, 'error'); }
    finally { setBusyId(null); }
  }

  async function analyze(id: number) {
    setBusyId(id);
    try {
      const result = await api(`/me/resumes/${id}/recommendations`, { method: 'POST' });
      const items = (result.recommendations || []) as Recommendation[];
      setRecommendations(current => ({ ...current, [id]: items }));
      setSelected(current => ({ ...current, [id]: items.map(item => item.id) }));
      showToast(items.length ? `${items.length} recommendations are ready.` : 'No actionable changes were found.', 'success');
    } catch (error) { showToast((error as Error).message, 'error'); }
    finally { setBusyId(null); }
  }

  async function applySelected(resume: ResumeInsight) {
    const chosen = selected[resume.id] || [];
    if (!chosen.length) { showToast('Select at least one recommendation.', 'error'); return; }
    setBusyId(resume.id);
    try {
      const result = await api(`/me/resumes/${resume.id}/apply-recommendations`, { method: 'POST', body: JSON.stringify({ recommendation_ids: chosen, recommendations: recommendations[resume.id] || [] }) });
      showToast(`Created version ${result.version} as a new resume.`, 'success');
      setRecommendations(current => { const next = { ...current }; delete next[resume.id]; return next; });
      await load();
    } catch (error) { showToast((error as Error).message, 'error'); }
    finally { setBusyId(null); }
  }

  function toggle(resumeId: number, id: string) {
    setSelected(current => {
      const values = current[resumeId] || [];
      return { ...current, [resumeId]: values.includes(id) ? values.filter(value => value !== id) : [...values, id] };
    });
  }

  return <>
    {loading && <section className="card"><p>Checking saved resume evidence…</p></section>}
    {data && <>
      <section className="grid" aria-label="Resume intelligence summary">
        <article className="card"><h3>Resumes</h3><div className="metric"><strong>{data.summary.resume_count}</strong></div><p>available for matching</p></article>
        <article className="card"><h3>Best readiness</h3><div className="metric"><strong>{data.summary.best_score == null ? '—' : `${data.summary.best_score}%`}</strong></div><p>based on stored evidence</p></article>
        <article className="card"><h3>Target roles</h3><div className="metric"><strong>{data.profile_titles.length}</strong></div><p>across active profiles</p></article>
      </section>
      {!data.resumes.length ? <section className="card" style={{ marginTop: 24 }}><h2>No resumes yet</h2><p>Upload a resume to begin evaluating readiness and role alignment.</p><a className="button" href="/resumes" style={{ marginTop: 18 }}>Upload a resume</a></section> :
      <section style={{ marginTop: 32 }}><div className="section-heading"><div><span className="eyebrow">Saved resumes</span><h2 style={{ marginTop: 14 }}>Evidence and readiness by version</h2></div><p>Review every AI suggestion before it becomes a new version.</p></div><div className="stack">
        {data.resumes.map(resume => <article className="card" key={resume.id} style={{ position: 'relative' }}>
          <button type="button" aria-label={`Remove ${resume.name}`} onClick={() => setRemoveId(resume.id)} style={{ position: 'absolute', top: 10, right: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 44, minWidth: 44, height: 44, padding: 0, border: 0, borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'inherit', fontSize: 26, cursor: 'pointer' }}>×</button>
          {removeId === resume.id && <div className="card" role="alertdialog" aria-labelledby={`remove-resume-title-${resume.id}`} onKeyDown={(event) => { if (event.key === 'Escape') setRemoveId(null); }} style={{ position: 'absolute', zIndex: 5, top: 56, right: 18, width: 'min(360px, calc(100% - 36px))', boxShadow: '0 18px 60px rgba(0,0,0,.35)' }}><h3 id={`remove-resume-title-${resume.id}`}>Remove this resume?</h3><p>This removes the file and clears its profile and application associations. This cannot be undone.</p><div style={{ display: 'flex', gap: 10, marginTop: 16 }}><button className="button" type="button" disabled={busyId === resume.id} onClick={() => void removeResume(resume.id)}>Yes, remove</button><button className="button ghost" type="button" autoFocus onClick={() => setRemoveId(null)}>No, keep it</button></div></div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', paddingRight: 30 }}><div><span className="pill">{resume.is_default ? 'Default resume' : `Version ${resume.version}`}</span><h2 style={{ marginTop: 14 }}>{resume.name}</h2></div><div className="metric"><strong>{resume.readiness_score}%</strong><span className="muted">ready</span></div></div>
          <p>{resume.text_character_count.toLocaleString()} readable characters · {resume.aligned_profile_titles.length} aligned target role{resume.aligned_profile_titles.length === 1 ? '' : 's'}</p>
          <div className="two" style={{ marginTop: 22 }}><div><h3>Strengths</h3><ul>{resume.strengths.map(item => <li key={item}>{item}</li>)}</ul></div><div><h3>Next improvements</h3><ul>{resume.gaps.length ? resume.gaps.map(item => <li key={item}>{item}</li>) : <li>No immediate gaps detected.</li>}</ul></div></div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}><button className="button" type="button" disabled={busyId === resume.id} onClick={() => void analyze(resume.id)}>{busyId === resume.id ? 'Working…' : recommendations[resume.id] ? 'Regenerate recommendations' : 'Generate AI recommendations'}</button><a className="button secondary" href="/resumes">Edit resume details</a></div>
          {recommendations[resume.id] && <section style={{ marginTop: 26 }}><div className="section-heading"><div><span className="eyebrow">Actionable recommendations</span><h3 style={{ marginTop: 10 }}>Review proposed changes</h3></div><p>Selected changes create a new version.</p></div><div className="stack">
            {recommendations[resume.id].map(item => <article className="card" key={item.id} style={{ padding: 20 }}><label style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}><input type="checkbox" checked={(selected[resume.id] || []).includes(item.id)} onChange={() => toggle(resume.id, item.id)} /><span><strong>{item.title}</strong><span className="pill" style={{ marginLeft: 10 }}>{item.confidence}% confidence</span></span></label><p className="muted">{item.section} · {item.reason}</p><div className="two" style={{ marginTop: 16 }}><div><h4>Current</h4><p style={{ whiteSpace: 'pre-wrap' }}>{item.current_text || 'No matching text identified.'}</p></div><div><h4>Recommended</h4><p style={{ whiteSpace: 'pre-wrap' }}>{item.proposed_text}</p></div></div></article>)}
          </div><button className="button" type="button" style={{ marginTop: 18 }} disabled={busyId === resume.id} onClick={() => void applySelected(resume)}>Apply selected as new version</button></section>}
        </article>)}
      </div></section>}
    </>}
  </>;
}
