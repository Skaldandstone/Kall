'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import ProfessionalProfileSelect from '../components/ProfessionalProfileSelect';
import { fetchKall } from '../lib/api';

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

/** One reviewed piece of tailoring work, named by the job it was built for. */
type ProposalSummary = {
  id: number;
  status: string;
  job_title: string;
  company: string | null;
  change_count: number;
  pending_count: number;
  has_document: boolean;
};

async function detail(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return typeof body?.detail === 'string' ? body.detail : fallback;
  } catch {
    return fallback;
  }
}

function proposalLabel(proposal: ProposalSummary) {
  return proposal.company ? `${proposal.job_title} · ${proposal.company}` : proposal.job_title;
}

export default function TailoringTab() {
  const [profileId, setProfileId] = useState('');
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [proposal, setProposal] = useState<ProposalSummary | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [unsupported, setUnsupported] = useState<string[]>([]);
  const [proposalStatus, setProposalStatus] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const loadProposals = useCallback(async () => {
    const response = await fetchKall('/tailoring/proposals');
    if (!response.ok) return [] as ProposalSummary[];
    const rows: ProposalSummary[] = await response.json();
    setProposals(rows);
    return rows;
  }, []);

  const open = useCallback(async (id: number, known?: ProposalSummary[]) => {
    const response = await fetchKall(`/tailoring/proposals/${id}`);
    if (!response.ok) {
      setMessage(await detail(response, 'Unable to open that tailored resume.'));
      return;
    }
    const data = await response.json();
    setChanges(data.changes);
    setUnsupported(data.proposal.unsupported_requirements || []);
    setProposalStatus(data.proposal.status);
    const rows = known ?? await loadProposals();
    setProposal(rows.find((row) => row.id === id) ?? null);
  }, [loadProposals]);

  // Resuming half-finished work, and arriving from the generate tab, both
  // name the job rather than asking anyone to carry an identifier across.
  useEffect(() => {
    void (async () => {
      const rows = await loadProposals();
      const requested = new URLSearchParams(window.location.search).get('proposal');
      const resume = requested && rows.some((row) => String(row.id) === requested)
        ? Number(requested)
        : rows.find((row) => row.pending_count > 0)?.id;
      if (resume) await open(resume, rows);
    })();
  }, [loadProposals, open]);

  async function createProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileId) {
      setMessage('Choose a career direction so Kall knows which record to tailor from.');
      return;
    }
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setMessage('Reading the posting and checking it against your record…');
    try {
      const jobResponse = await fetchKall('/jobs/import-search-result', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          url: String(data.get('job_url') || ''),
          title: String(data.get('job_title') || ''),
          snippet: String(data.get('job_description') || ''),
          source: 'resume_studio',
        }),
      });
      const job = await jobResponse.json();
      if (!jobResponse.ok) {
        setMessage(typeof job?.detail === 'string' ? job.detail : 'Kall could not save that job description.');
        return;
      }
      const response = await fetchKall('/tailoring/proposals', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({job_id:Number(job.id), professional_profile_id:Number(profileId)})
      });
      const created = await response.json();
      if (!response.ok) {
        setMessage(typeof created?.detail === 'string' ? created.detail : 'Unable to prepare a tailored resume.');
        return;
      }
      await open(created.id);
      setMessage('');
    } finally {
      setBusy(false);
    }
  }

  async function decide(change: Change, status: string, edited_text?: string) {
    const response = await fetchKall(`/tailoring/changes/${change.id}`, {
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({status, edited_text: edited_text || null})
    });
    if (!response.ok) {
      setMessage(await detail(response, 'Unable to save that decision.'));
      return;
    }
    const data = await response.json();
    setChanges(current => current.map(item => item.id === data.id ? data : item));
  }

  async function finalize() {
    if (!proposal) return;
    setBusy(true);
    try {
      const response = await fetchKall(`/tailoring/proposals/${proposal.id}/finalize`, { method: 'POST' });
      if (!response.ok) {
        setMessage(await detail(response, 'Unable to finalize this tailored resume.'));
        return;
      }
      const data = await response.json();
      setProposalStatus(data.status);
      setMessage('');
      void loadProposals();
    } finally {
      setBusy(false);
    }
  }

  const pending = changes.filter((change) => change.status === 'pending').length;
  const answered = changes.length - pending;

  return <>
    <section className="card">
      <h2>Evidence-grounded tailoring</h2>
      <p>Link the job posting and paste its description. Kall uses the actual requirements to prepare changes, and every proposed change must be reviewed before export.</p>
      <form className="form" onSubmit={createProposal}>
        <label><span className="muted">Job posting link</span><input className="input" name="job_url" type="url" placeholder="https://company.com/careers/role" required/></label>
        <div className="two">
          <label><span className="muted">Job title</span><input className="input" name="job_title" placeholder="e.g. Executive Chef, Account Executive, Art Director" required/></label>
          <ProfessionalProfileSelect value={profileId} onChange={setProfileId} />
        </div>
        <label><span className="muted">Job description</span><textarea className="input" name="job_description" rows={8} placeholder="Paste the responsibilities and requirements from the posting" required/></label>
        <button className="button" disabled={!profileId || busy}>{busy ? 'Working…' : 'Create proposal'}</button>
      </form>
      {proposals.length > 0 && <label style={{ marginTop: 20, display: 'block' }}>
        <span className="muted">Or continue a job you already started</span>
        <select className="input" value={proposal ? String(proposal.id) : ''} onChange={(event) => { if (event.target.value) void open(Number(event.target.value)); }}>
          <option value="">Choose a job</option>
          {proposals.map((item) => <option key={item.id} value={item.id}>
            {proposalLabel(item)}{item.pending_count ? ` — ${item.pending_count} left to review` : ' — reviewed'}
          </option>)}
        </select>
      </label>}
    </section>

    <p className="notice" role="status" aria-live="polite" style={{ marginTop: 18 }}>{message}</p>

    {proposal && changes.length > 0 && <section className="card" style={{ marginTop: 24 }}>
      <span className="eyebrow">{proposalLabel(proposal)}</span>
      <h2 style={{ marginTop: 14 }}>{answered} of {changes.length} reviewed</h2>
      <p>Nothing is written into your resume until you approve it, and dates and figures are never changed.</p>
    </section>}

    {unsupported.length > 0 && <section className="card" style={{ marginTop: 24 }}><h2>Requirements your resume does not show</h2><ul>{unsupported.map(item => <li key={item}>{item}</li>)}</ul></section>}
    {changes.map(change => <section className="card" key={change.id} style={{ marginTop: 24 }}>
      <span className="pill">{change.section}</span><h2>{change.reason}</h2>
      <div className="two"><div><h3>Original</h3><p>{change.original_text}</p></div><div><h3>Proposed</h3><textarea className="input" aria-label={`Proposed text for ${change.reason}`} id={`edit-${change.id}`} defaultValue={change.edited_text || change.proposed_text} rows={8}/></div></div>
      <p><strong>Evidence:</strong> {change.evidence.map(item => item.text).join(' · ')}</p>
      <div style={{display:'flex',gap:10,flexWrap:'wrap'}}><button className="button" onClick={() => decide(change,'accepted')}>Accept</button><button className="button secondary" onClick={() => decide(change,'edited',(document.getElementById(`edit-${change.id}`) as HTMLTextAreaElement).value)}>Save edit</button><button className="button secondary" onClick={() => decide(change,'rejected')}>Reject</button></div>
      <p>Status: {change.status}</p>
    </section>)}
    {changes.length > 0 && <section className="card" style={{ marginTop: 24 }}>
      {proposalStatus === 'finalized' ? (
        <>
          <h2>Reviewed and ready to build</h2>
          <p>Choose a layout and export the files, or save the result to your resumes.</p>
          <a className="button" href={`/resumes?tab=generate&proposal=${proposal?.id ?? ''}`} style={{ marginTop: 18 }}>Choose a look and build</a>
        </>
      ) : (
        <>
          <button className="button" disabled={pending > 0 || busy} onClick={finalize}>
            {pending > 0 ? `${pending} change${pending === 1 ? '' : 's'} left to review` : 'Finalize and choose a look'}
          </button>
          {pending > 0 && <p className="muted">Every change above must be accepted, edited, or rejected before this proposal can be finalized.</p>}
        </>
      )}
    </section>}
  </>;
}
