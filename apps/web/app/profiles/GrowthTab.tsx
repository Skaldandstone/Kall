'use client';

import { FormEvent, useEffect, useState } from 'react';

const API = '/api/kall';

type Milestone = { id:number; sequence:number; phase:string; title:string; description:string; category:string; target_date?:string|null; estimated_hours?:number|null; status:string };
type Resource = { id:number; title:string; provider?:string|null; url:string; description?:string|null; cost_type?:string|null; difficulty?:string|null; estimated_hours?:number|null };
type Search = { id:number; category:string; query:string; search_url:string; rationale:string };
type Plan = { plan:{id:number; summary:string; current_strengths:string[]; skill_gaps:string[]; recommended_roles:string[]}; milestones:Milestone[]; resources:Resource[]; searches:Search[]; progress:Array<{id:number;note:string;occurred_at:string}> };
type Goal = { id:number; title:string; target_role:string; target_industry?:string|null; target_date?:string|null; time_per_week_hours?:number|null; status:string };
type Dashboard = { goals:Array<{goal:Goal; plan:Plan|null}> };

function authHeaders(json=false) {
  const token = localStorage.getItem('kall_token');
  return { Authorization:`Bearer ${token}`, ...(json ? {'Content-Type':'application/json'} : {}) };
}

export default function GrowthTab() {
  const [data,setData]=useState<Dashboard|null>(null);
  const [message,setMessage]=useState('Loading your growth workspace…');
  const [busy,setBusy]=useState(false);

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

  async function load() {
    const token = localStorage.getItem('kall_token');
    if (!token) return window.location.replace('/login');
    try { setData(await request('/growth',{headers:authHeaders()})); setMessage(''); }
    catch(error) { if ((error as Error).message !== 'signed-out') setMessage((error as Error).message); }
  }

  useEffect(() => { void load(); }, []);

  async function createGoal(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('Creating your goal…');
    const form = new FormData(event.currentTarget);
    try {
      const goal = await request('/growth/goals',{method:'POST',headers:authHeaders(true),body:JSON.stringify({
        title:form.get('title'), target_role:form.get('target_role'), target_industry:form.get('target_industry') || null,
        current_level:form.get('current_level') || null, target_level:form.get('target_level') || null,
        target_date:form.get('target_date') || null, time_per_week_hours:Number(form.get('time_per_week_hours')) || null,
        budget_preference:form.get('budget_preference') || null, notes:form.get('notes') || null,
      })});
      await request(`/growth/goals/${goal.id}/plan`,{method:'POST',headers:authHeaders()});
      event.currentTarget.reset(); await load(); setMessage('Your growth plan is ready.');
    } catch(error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }

  async function generate(goalId:number) {
    setBusy(true); setMessage('Building your plan…');
    try { await request(`/growth/goals/${goalId}/plan`,{method:'POST',headers:authHeaders()}); await load(); setMessage('Growth plan created.'); }
    catch(error) { setMessage((error as Error).message); } finally { setBusy(false); }
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

      {data?.goals.length === 0 && <section className="card" style={{marginTop:24}}><h2>Your first plan starts above.</h2><p>Describe the work you want to do. Kall will organize the first research, education, portfolio, and networking steps.</p></section>}

      <div className="stack" style={{marginTop:32}}>{data?.goals.map(({goal,plan}) => <section className="card" key={goal.id}>
        <span className="pill">{goal.status}</span><h2 style={{marginTop:14}}>{goal.title}</h2><p>{goal.target_role}{goal.target_industry ? ` · ${goal.target_industry}` : ''}{goal.target_date ? ` · Target ${new Date(goal.target_date).toLocaleDateString()}` : ''}</p>
        {!plan ? <button className="button" style={{marginTop:18}} disabled={busy} onClick={() => generate(goal.id)}>Generate plan</button> : <>
          <p style={{marginTop:20}}>{plan.plan.summary}</p>
          <div className="two" style={{marginTop:22}}><div><h3>Current strengths</h3><ul>{plan.plan.current_strengths.map(item=><li key={item}>{item}</li>)}</ul></div><div><h3>Priority gaps</h3><ul>{plan.plan.skill_gaps.map(item=><li key={item}>{item}</li>)}</ul></div></div>
          <h3 style={{marginTop:26}}>Milestones</h3><div className="stack">{plan.milestones.map(item => <article className="card" key={item.id}><span className="eyebrow">{item.phase}</span><h2 style={{marginTop:12}}>{item.title}</h2><p>{item.description}</p><p style={{marginTop:10}}>{item.estimated_hours ? `${item.estimated_hours} estimated hours` : 'Flexible timing'}{item.target_date ? ` · Target ${new Date(item.target_date).toLocaleDateString()}` : ''}</p></article>)}</div>
          <div className="two" style={{marginTop:24}}><div><h3>Resources</h3>{plan.resources.map(item=><p key={item.id}><a href={item.url} target="_blank" rel="noreferrer"><strong>{item.title}</strong></a><br/>{item.description}</p>)}</div><div><h3>Live research paths</h3>{plan.searches.map(item=><p key={item.id}><a href={item.search_url} target="_blank" rel="noreferrer"><strong>{item.query}</strong></a><br/>{item.rationale}</p>)}</div></div>
        </>}
      </section>)}</div>
    </>
  );
}
