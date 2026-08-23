'use client';

import { FormEvent, useEffect, useState } from 'react';
import GoogleResourceSearchResults from '../components/GoogleResourceSearchResults';

const API = '/api/kall';

type Milestone = { id:number; sequence:number; phase:string; title:string; description:string; category:string; target_date?:string|null; estimated_hours?:number|null; status:string };
type Resource = { id:number; title:string; provider?:string|null; url:string; description?:string|null; cost_type?:string|null; difficulty?:string|null; estimated_hours?:number|null; saved:boolean };
type Search = { id:number; category:string; query:string; search_url:string; rationale:string };
type Assessment = { id:number; answer_text:string; applicable_skills:Array<{skill:string; how_it_applies:string}>; gaps:string[]; readiness_score:number; narrative:string; provider:string; created_at:string };
type Plan = { plan:{id:number; provider:string; summary:string; current_strengths:string[]; skill_gaps:string[]; recommended_roles:string[]}; milestones:Milestone[]; resources:Resource[]; searches:Search[]; progress:Array<{id:number;note:string;occurred_at:string}>; skill_assessments:Assessment[] };
type Goal = { id:number; title:string; target_role:string; target_industry?:string|null; target_date?:string|null; time_per_week_hours?:number|null; status:string };
type Dashboard = { goals:Array<{goal:Goal; plan:Plan|null}> };

function authHeaders(json=false) {
  const token = localStorage.getItem('kall_token');
  return { Authorization:`Bearer ${token}`, ...(json ? {'Content-Type':'application/json'} : {}) };
}

async function request(path:string, init?:RequestInit) {
  const response = await fetch(`${API}${path}`, init);
  if (response.status === 401) {
    localStorage.removeItem('kall_token');
    window.location.replace('/login');
    throw new Error('signed-out');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || 'The growth workspace could not complete that request.');
  return body;
}

export default function GrowthTab() {
  const [data,setData]=useState<Dashboard|null>(null);
  const [message,setMessage]=useState('Loading your growth workspace…');
  const [busy,setBusy]=useState(false);

  async function load() {
    const token = localStorage.getItem('kall_token');
    if (!token) return window.location.replace('/login');
    try { setData(await request('/growth',{headers:authHeaders()})); setMessage(''); }
    catch(error) { if ((error as Error).message !== 'signed-out') setMessage((error as Error).message); }
  }

  useEffect(() => { void load(); }, []);

  async function createGoal(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('Creating your goal…');
    const formElement = event.currentTarget; // capture before any await -- currentTarget is null afterward
    const form = new FormData(formElement);
    try {
      const goal = await request('/growth/goals',{method:'POST',headers:authHeaders(true),body:JSON.stringify({
        title:form.get('title'), target_role:form.get('target_role'), target_industry:form.get('target_industry') || null,
        current_level:form.get('current_level') || null, target_level:form.get('target_level') || null,
        target_date:form.get('target_date') || null, time_per_week_hours:Number(form.get('time_per_week_hours')) || null,
        budget_preference:form.get('budget_preference') || null, notes:form.get('notes') || null,
      })});
      await request(`/growth/goals/${goal.id}/plan`,{method:'POST',headers:authHeaders(true),body:JSON.stringify({})});
      formElement.reset(); await load(); setMessage('Your growth plan is ready.');
    } catch(error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }

  async function generate(goalId:number, regenerate:boolean) {
    setBusy(true); setMessage(regenerate ? 'Regenerating your plan…' : 'Building your plan…');
    try {
      await request(`/growth/goals/${goalId}/plan`,{method:'POST',headers:authHeaders(true),body:JSON.stringify({regenerate})});
      await load(); setMessage(regenerate ? 'Growth plan regenerated.' : 'Growth plan created.');
    } catch(error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }

  async function pinResource(resourceId:number, saved:boolean) {
    try { await request(`/growth/resources/${resourceId}`,{method:'PATCH',headers:authHeaders(true),body:JSON.stringify({saved})}); await load(); }
    catch(error) { setMessage((error as Error).message); }
  }

  return (
    <>
      <section className="card"><h2>Create a career goal</h2><form className="form" onSubmit={createGoal}>
        <div className="two"><input className="input" name="title" placeholder="Goal name, e.g. Move into game art" required/><input className="input" name="target_role" placeholder="Target role, e.g. Environment Artist" required/></div>
        <div className="two"><input className="input" name="target_industry" placeholder="Target industry"/><input className="input" name="target_date" type="date"/></div>
        <div className="two"><input className="input" name="current_level" placeholder="Current level or background"/><input className="input" name="target_level" placeholder="Target level"/></div>
        <div className="two"><input className="input" name="time_per_week_hours" type="number" min="1" max="80" defaultValue="5"/><select className="input" name="budget_preference" defaultValue="free_or_low_cost"><option value="free_or_low_cost">Free or low cost</option><option value="flexible">Flexible budget</option><option value="premium">Premium options considered</option></select></div>
        <textarea className="input" name="notes" rows={4} placeholder="Relevant experience, constraints, or priorities"/>
        <button className="button" disabled={busy}>{busy ? 'Building plan…' : 'Create goal and plan'}</button>
      </form><p className="notice" aria-live="polite">{message}</p></section>

      {data?.goals.length === 0 && <section className="card" style={{marginTop:24}}><h2>Your first plan starts above.</h2><p>Describe the work you want to do. Kall will organize the first research, education, portfolio, and networking steps, and can search the web for real courses and guides once your plan exists.</p></section>}

      <div className="stack" style={{marginTop:32}}>{data?.goals.map(({goal,plan}) => (
        <GoalCard key={goal.id} goal={goal} plan={plan} busy={busy} onGenerate={generate} onPin={pinResource} onReload={load} onError={setMessage} />
      ))}</div>
    </>
  );
}

function GoalCard({ goal, plan, busy, onGenerate, onPin, onReload, onError }: {
  goal:Goal; plan:Plan|null; busy:boolean;
  onGenerate:(goalId:number, regenerate:boolean)=>Promise<void>;
  onPin:(resourceId:number, saved:boolean)=>Promise<void>;
  onReload:()=>Promise<void>;
  onError:(message:string)=>void;
}) {
  const [answer, setAnswer] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [activeQuery, setActiveQuery] = useState('');

  async function analyzeSkills() {
    if (answer.trim().length < 2) { onError('Describe your current skills or background first.'); return; }
    setAnalyzing(true);
    try {
      await request(`/growth/goals/${goal.id}/skills-analysis`,{method:'POST',headers:authHeaders(true),body:JSON.stringify({answer})});
      setAnswer('');
      await onReload();
    } catch(error) { onError((error as Error).message); }
    finally { setAnalyzing(false); }
  }

  const latestAssessment = plan?.skill_assessments[0];
  const sortedResources = plan ? [...plan.resources].sort((a,b) => Number(b.saved) - Number(a.saved)) : [];

  return (
    <section className="card">
      <span className="pill">{goal.status}</span><h2 style={{marginTop:14}}>{goal.title}</h2>
      <p>{goal.target_role}{goal.target_industry ? ` · ${goal.target_industry}` : ''}{goal.target_date ? ` · Target ${new Date(goal.target_date).toLocaleDateString()}` : ''}</p>

      {!plan ? <button className="button" style={{marginTop:18}} disabled={busy} onClick={() => onGenerate(goal.id, false)}>Generate plan</button> : <>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16, marginTop:20, flexWrap:'wrap'}}>
          <p style={{margin:0}}>{plan.plan.summary}</p>
          <button className="button secondary" disabled={busy} onClick={() => onGenerate(goal.id, true)}>Regenerate plan</button>
        </div>
        <div className="two" style={{marginTop:22}}><div><h3>Current strengths</h3><ul>{plan.plan.current_strengths.map(item=><li key={item}>{item}</li>)}</ul></div><div><h3>Priority gaps</h3><ul>{plan.plan.skill_gaps.map(item=><li key={item}>{item}</li>)}</ul></div></div>

        <h3 style={{marginTop:26}}>Milestones</h3><div className="stack">{plan.milestones.map(item => <article className="card" key={item.id}><span className="eyebrow">{item.phase}</span><h2 style={{marginTop:12}}>{item.title}</h2><p>{item.description}</p><p style={{marginTop:10}}>{item.estimated_hours ? `${item.estimated_hours} estimated hours` : 'Flexible timing'}{item.target_date ? ` · Target ${new Date(item.target_date).toLocaleDateString()}` : ''}</p></article>)}</div>

        <article className="card" style={{marginTop:26}}>
          <h2>Analyze my skills</h2>
          <p>Describe your current skills, education, or vocational experience. Kall will show how it applies to {goal.target_role}.</p>
          <textarea className="input" rows={4} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="e.g. I have three years of experience building websites, plus a certificate in UX design…"/>
          <button className="button" style={{marginTop:12}} disabled={analyzing} onClick={() => void analyzeSkills()}>{analyzing ? 'Analyzing…' : 'AI Analyze'}</button>
          {latestAssessment && <div style={{marginTop:20}}>
            <div className="metric"><strong>{latestAssessment.readiness_score}%</strong><span className="muted">readiness</span></div>
            <p style={{marginTop:10}}>{latestAssessment.narrative}</p>
            {latestAssessment.applicable_skills.length > 0 && <><h3 style={{marginTop:16}}>How your background applies</h3><ul>{latestAssessment.applicable_skills.map(item => <li key={item.skill}><strong>{item.skill}:</strong> {item.how_it_applies}</li>)}</ul></>}
            {latestAssessment.gaps.length > 0 && <><h3 style={{marginTop:16}}>Remaining gaps</h3><ul>{latestAssessment.gaps.map(item => <li key={item}>{item}</li>)}</ul></>}
          </div>}
        </article>

        <article className="card" style={{marginTop:26}}>
          <h2>Find learning resources</h2>
          <p>Search the web for real courses, guides, and communities, and save the ones worth keeping.</p>
          <div style={{display:'flex', gap:8, flexWrap:'wrap', marginTop:12}}>
            {plan.searches.map(item => <button key={item.id} type="button" className="button secondary" onClick={() => setActiveQuery(item.query)}>{item.query}</button>)}
          </div>
          <form style={{display:'flex', gap:8, marginTop:12}} onSubmit={(event) => { event.preventDefault(); const value = new FormData(event.currentTarget).get('query'); if (value) setActiveQuery(String(value)); }}>
            <input className="input" name="query" placeholder="Search for something specific…" defaultValue={activeQuery}/>
            <button className="button secondary" type="submit">Search</button>
          </form>
          {activeQuery && <div style={{marginTop:16}}><GoogleResourceSearchResults query={activeQuery} planId={plan.plan.id} onSaved={() => void onReload()} /></div>}
        </article>

        <div className="two" style={{marginTop:24}}>
          <div>
            <h3>Resources</h3>
            {sortedResources.length === 0 && <p className="muted">Search above and save resources that look worthwhile.</p>}
            {sortedResources.map(item=>
              <div key={item.id} style={{marginBottom:14}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:10}}>
                  <a href={item.url} target="_blank" rel="noreferrer"><strong>{item.title}</strong></a>
                  <button className={`button ${item.saved ? '' : 'secondary'}`} type="button" onClick={() => void onPin(item.id, !item.saved)}>{item.saved ? 'Pinned' : 'Pin'}</button>
                </div>
                {item.description && <p style={{margin:'4px 0 0'}}>{item.description}</p>}
              </div>
            )}
          </div>
          <div><h3>Live research paths</h3>{plan.searches.map(item=><p key={item.id}><a href={item.search_url} target="_blank" rel="noreferrer"><strong>{item.query}</strong></a><br/>{item.rationale}</p>)}</div>
        </div>
      </>}
    </section>
  );
}
