'use client';

import { FormEvent, useState } from 'react';
import ProfessionalProfileSelect from '../components/ProfessionalProfileSelect';

const API = '/api/kall';

type Change = {
  id: number;
  section: string;
  original_text: string;
  proposed_text: string;
  edited_text?: string | null;
  reason: string;
  evidence: Array<{type:string; id:number; text:string}>;
  status: string;
};

export default function TailoringTab() {
  const [profileId, setProfileId] = useState('');
  const [proposalId, setProposalId] = useState('');
  const [changes, setChanges] = useState<Change[]>([]);
  const [unsupported, setUnsupported] = useState<string[]>([]);
  const [proposalStatus, setProposalStatus] = useState('');

  async function createProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileId) return alert('Create or select a professional profile first.');
    const data = new FormData(event.currentTarget);
    const response = await fetch(`${API}/tailoring/proposals`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({job_id:Number(data.get('job_id')), professional_profile_id:Number(profileId)})
    });
    const proposal = await response.json();
    if (!response.ok) return alert(proposal.detail || 'Unable to create proposal');
    setProposalId(String(proposal.id));
    await load(String(proposal.id));
  }

  async function load(id = proposalId) {
    const response = await fetch(`${API}/tailoring/proposals/${id}`);
    const data = await response.json();
    if (!response.ok) return alert(data.detail || 'Unable to load proposal');
    setChanges(data.changes);
    setUnsupported(data.proposal.unsupported_requirements || []);
    setProposalStatus(data.proposal.status);
  }

  async function decide(change: Change, status: string, edited_text?: string) {
    const response = await fetch(`${API}/tailoring/changes/${change.id}`, {
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({status, edited_text: edited_text || null})
    });
    const data = await response.json();
    if (!response.ok) return alert(data.detail || 'Unable to save decision');
    setChanges(current => current.map(item => item.id === data.id ? data : item));
  }

  async function finalize() {
    const response = await fetch(`${API}/tailoring/proposals/${proposalId}/finalize`, {
      method: 'POST'
    });
    const data = await response.json();
    if (!response.ok) return alert(data.detail || 'Unable to finalize proposal');
    setProposalStatus(data.status);
  }

  return <>
    <section className="card">
      <h2>Evidence-grounded tailoring</h2>
      <p>Create a proposal for a job. Every proposed change to your resume must be reviewed and grounded in real evidence before use in Generate.</p>
      <form className="form" onSubmit={createProposal}>
        <div className="two">
          <label><span className="muted">Job ID</span><input className="input" name="job_id" placeholder="Job ID" required/></label>
          <ProfessionalProfileSelect value={profileId} onChange={setProfileId} />
        </div>
        <button className="button" disabled={!profileId}>Create proposal</button>
      </form>
    </section>
    {unsupported.length > 0 && <section className="card"><h2>Unsupported requirements</h2><ul>{unsupported.map(item => <li key={item}>{item}</li>)}</ul></section>}
    {changes.map(change => <section className="card" key={change.id}>
      <span className="pill">{change.section}</span><h2>{change.reason}</h2>
      <div className="two"><div><h3>Original</h3><p>{change.original_text}</p></div><div><h3>Proposed</h3><textarea className="input" id={`edit-${change.id}`} defaultValue={change.edited_text || change.proposed_text} rows={8}/></div></div>
      <p><strong>Evidence:</strong> {change.evidence.map(item => item.text).join(' · ')}</p>
      <div style={{display:'flex',gap:10}}><button className="button" onClick={() => decide(change,'accepted')}>Accept</button><button className="button secondary" onClick={() => decide(change,'edited',(document.getElementById(`edit-${change.id}`) as HTMLTextAreaElement).value)}>Save edit</button><button className="button secondary" onClick={() => decide(change,'rejected')}>Reject</button></div>
      <p>Status: {change.status}{proposalId ? <> · Proposal <code>{proposalId}</code></> : null}</p>
    </section>)}
    {changes.length > 0 && <section className="card">
      {proposalStatus === 'finalized' ? (
        <p>Proposal <code>{proposalId}</code> is finalized — use this ID in Generate.</p>
      ) : (
        <>
          <button className="button" disabled={changes.some(change => change.status === 'pending')} onClick={finalize}>Finalize proposal</button>
          {changes.some(change => change.status === 'pending') && <p className="muted">Every change above must be accepted, edited, or rejected before this proposal can be finalized.</p>}
        </>
      )}
    </section>}
  </>;
}
