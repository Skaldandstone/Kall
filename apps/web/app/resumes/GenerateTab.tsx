'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { fetchKall } from '../lib/api';

// byte_size is null until that format has actually been rendered, which
// happens on the first download rather than at generation time.
type Artifact = { id: number | null; format: string; byte_size: number | null };
type Coverage = {
  required_percent: number;
  preferred_percent: number;
  unsupported: string[];
};
type DocumentResult = {
  document: { id: number; template_key: string; checksum: string };
  artifacts: Artifact[];
  coverage?: Coverage;
};

type CoverLetterResult = {
  proposal: { id: number; status: string };
  changes: Array<{
    id: number;
    position: number;
    proposed_text: string;
    edited_text?: string;
    status: string;
  }>;
};

/** One reviewed piece of tailoring work, named by the job it was built for. */
type ProposalSummary = {
  id: number;
  status: string;
  job_title: string;
  company: string | null;
  job_url: string | null;
  change_count: number;
  pending_count: number;
  has_document: boolean;
  created_at: string;
  finalized_at: string | null;
};

const TEMPLATES = {
  standard: { label: 'Classic chronological', use: 'A familiar structure for most roles and industries.', order: ['Summary', 'Experience', 'Skills', 'Education'] },
  executive: { label: 'Leadership and impact', use: 'For senior leaders whose scope, decisions, and outcomes should lead.', order: ['Leadership profile', 'Selected impact', 'Experience', 'Education'] },
  creative: { label: 'Creative and portfolio', use: 'For art, design, writing, performance, and other portfolio-backed work.', order: ['Creative profile', 'Selected work', 'Experience', 'Skills'] },
  commercial: { label: 'Sales and customer outcomes', use: 'For sales, account management, fundraising, and customer-facing work.', order: ['Commercial profile', 'Results', 'Experience', 'Skills'] },
  service: { label: 'Service, hospitality, and skilled work', use: 'For culinary, hospitality, retail, trades, operations, and hands-on roles.', order: ['Professional profile', 'Core capabilities', 'Experience', 'Training'] },
  early: { label: 'Early career and career change', use: 'For transferable skills, training, projects, and emerging experience.', order: ['Objective', 'Transferable skills', 'Projects and experience', 'Education'] },
  compact: { label: 'Compact two-page', use: 'For long work histories that need a concise, scan-friendly structure.', order: ['Summary', 'Selected achievements', 'Recent experience', 'Earlier experience'] },
} as const;
type TemplateKey = keyof typeof TEMPLATES;
const TEMPLATE_KEYS = Object.keys(TEMPLATES) as TemplateKey[];

function proposalLabel(proposal: ProposalSummary) {
  return proposal.company ? `${proposal.job_title} · ${proposal.company}` : proposal.job_title;
}

export default function GenerateTab() {
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [proposalId, setProposalId] = useState('');
  const [loadingProposals, setLoadingProposals] = useState(true);
  const [documentResult, setDocumentResult] = useState<DocumentResult | null>(null);
  const [coverLetter, setCoverLetter] = useState<CoverLetterResult | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState<string | null>(null);
  const [templateKey, setTemplateKey] = useState<TemplateKey>('standard');
  const [previews, setPreviews] = useState<Record<string, string>>({});

  const selected = proposals.find((proposal) => String(proposal.id) === proposalId) || null;
  const ready = Boolean(selected && selected.status === 'finalized');

  const loadProposals = useCallback(async () => {
    const response = await fetchKall('/tailoring/proposals');
    if (!response.ok) {
      setLoadingProposals(false);
      setMessage('Unable to load your tailoring work.');
      return;
    }
    const rows: ProposalSummary[] = await response.json();
    setProposals(rows);
    setLoadingProposals(false);
    // Arriving from the tailoring tab carries the proposal in the URL, so
    // nobody has to copy an identifier between two screens.
    const requested = new URLSearchParams(window.location.search).get('proposal');
    const preferred = requested && rows.some((row) => String(row.id) === requested)
      ? requested
      : String(rows.find((row) => row.status === 'finalized')?.id ?? '');
    setProposalId((current) => current || preferred);
  }, []);

  useEffect(() => { void loadProposals(); }, [loadProposals]);

  // Each sample is the person's own resume in that layout. A schematic of
  // section names cannot answer "which of these should I send?", which is
  // the only question this step asks.
  useEffect(() => {
    setPreviews({});
    if (!ready || !selected) return;
    let cancelled = false;
    const id = selected.id;
    const urls: string[] = [];
    (async () => {
      for (const key of TEMPLATE_KEYS) {
        if (cancelled) return;
        const response = await fetchKall(`/tailoring/${id}/previews/${key}.png`).catch(() => null);
        if (!response || !response.ok || cancelled) continue;
        const url = URL.createObjectURL(await response.blob());
        urls.push(url);
        if (cancelled) { URL.revokeObjectURL(url); return; }
        setPreviews((current) => ({ ...current, [key]: url }));
      }
    })();
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [ready, selected]);

  async function generateResume(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!proposalId) return;
    setBusy(true);
    setMessage('Building your tailored resume…');
    try {
      const response = await fetchKall(`/tailoring/${proposalId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_key: templateKey }),
      });
      const generated = await response.json();
      if (!response.ok) throw new Error(generated.detail || 'Generation failed');
      const detail = await fetchKall(`/documents/${generated.id}`);
      setDocumentResult(await detail.json());
      setMessage('Resume package generated.');
      void loadProposals();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Generation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function generateCoverLetter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!proposalId) return;
    setBusy(true);
    setMessage('Drafting a cover letter from the finalized resume…');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetchKall(`/tailoring/${proposalId}/cover-letter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emphasis: form.get('emphasis'),
          tone: form.get('tone'),
          length: form.get('length'),
          company_interest_notes: form.get('company_interest_notes'),
        }),
      });
      const proposal = await response.json();
      if (!response.ok) throw new Error(proposal.detail || 'Cover letter generation failed');
      const detail = await fetchKall(`/cover-letters/${proposal.id}`);
      setCoverLetter(await detail.json());
      setMessage('Cover letter draft is ready for review.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Cover letter generation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function decide(changeId: number, decision: 'accepted' | 'rejected') {
    const response = await fetchKall(`/cover-letter-changes/${changeId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    if (response.ok && coverLetter) {
      setCoverLetter({
        ...coverLetter,
        changes: coverLetter.changes.map((item) =>
          item.id === changeId ? { ...item, status: decision } : item,
        ),
      });
    }
  }

  // Plain <a href> links can't carry the Authorization header this endpoint
  // requires, so a direct anchor to it just 401s. Fetch the file with the
  // token instead and hand the browser a blob it can save.
  async function downloadArtifact(artifact: Artifact) {
    if (!documentResult) return;
    setDownloadingFormat(artifact.format);
    try {
      const response = await fetchKall(
        `/documents/${documentResult.document.id}/download/${artifact.format}`,
      );
      if (!response.ok) throw new Error('Unable to download this file.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${documentResult.document.template_key}.${artifact.format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to download this file.');
    } finally {
      setDownloadingFormat(null);
    }
  }

  const picker = (
    <label>
      <span className="muted">Tailored resume to use</span>
      <select
        className="input"
        value={proposalId}
        onChange={(event) => { setProposalId(event.target.value); setDocumentResult(null); setCoverLetter(null); }}
        disabled={loadingProposals || proposals.length === 0}
      >
        <option value="">{loadingProposals ? 'Loading your tailoring work…' : 'Choose a job'}</option>
        {proposals.map((proposal) => (
          <option key={proposal.id} value={proposal.id}>
            {proposalLabel(proposal)}
            {proposal.status === 'finalized' ? '' : ` — ${proposal.pending_count} question${proposal.pending_count === 1 ? '' : 's'} left`}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      {!loadingProposals && proposals.length === 0 && (
        <section className="card" style={{ marginBottom: 24 }}>
          <span className="eyebrow">Nothing to build yet</span>
          <h2 style={{ marginTop: 14 }}>Tailor a resume to a job first.</h2>
          <p>Paste a job posting into the Tailoring tab. Kall asks what is missing, you answer, and the approved answers become the files you export here.</p>
          <a className="button" href="/resumes?tab=tailoring" style={{ marginTop: 18 }}>Start tailoring</a>
        </section>
      )}

      {proposals.length > 0 && (
        <section className="grid">
          <article className="card">
            <h2>Generate resume package</h2>
            <p style={{ marginBottom: 20 }}>
              Choose the job you tailored for, then pick the layout to send.
            </p>
            <form className="form" onSubmit={generateResume}>
              {picker}
              {selected && !ready && (
                <p className="notice">
                  {selected.pending_count} question{selected.pending_count === 1 ? '' : 's'} still need an answer before this can be built.{' '}
                  <a href={`/resumes?tab=tailoring&proposal=${selected.id}`}>Finish reviewing it</a>.
                </p>
              )}
              <fieldset className="template-choice" disabled={!ready}>
                <legend>ATS-readable layout</legend>
                <p className="muted">
                  {ready
                    ? 'Each sample is your own resume, with the approved changes, in that layout.'
                    : 'Choose a finalized job above to see your own resume in each layout.'}
                </p>
                <div className="template-gallery" role="radiogroup" aria-label="ATS-readable layout">
                  {TEMPLATE_KEYS.map((key) => {
                    const template = TEMPLATES[key];
                    const active = templateKey === key;
                    return (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={active}
                        key={key}
                        className={`template-option${active ? ' is-selected' : ''}`}
                        onClick={() => setTemplateKey(key)}
                      >
                        {previews[key] ? (
                          <img className="template-shot" src={previews[key]} alt={`Your resume in the ${template.label} layout`} />
                        ) : (
                          <span className="template-sheet" aria-hidden="true">
                            <strong>Your Name</strong>
                            <span>Contact details · Location</span>
                            {template.order.map((section) => <span key={section} className="template-row"><b>{section}</b><i /><i /></span>)}
                          </span>
                        )}
                        <strong className="template-name">{template.label}</strong>
                        <small>{template.use}</small>
                      </button>
                    );
                  })}
                </div>
                <p className="muted">Single column, standard headings, selectable text, and no decorative graphics that interfere with parsing.</p>
              </fieldset>
              <button className="button" disabled={busy || !ready}>Generate files</button>
            </form>
          </article>

          <article className="card">
            <h2>Draft grounded cover letter</h2>
            <p style={{ marginBottom: 20 }}>Drafted from the same finalized resume. Every paragraph needs your review.</p>
            <form className="form" onSubmit={generateCoverLetter}>
              <div className="two">
                <label><span className="muted">Emphasis</span><select className="input" name="emphasis" defaultValue="balanced">
                  <option value="balanced">Balanced</option>
                  <option value="executive">Executive</option>
                  <option value="technical">Technical</option>
                </select></label>
                <label><span className="muted">Tone</span><select className="input" name="tone" defaultValue="formal">
                  <option value="formal">Formal</option>
                  <option value="conversational">Conversational</option>
                </select></label>
              </div>
              <label><span className="muted">Length</span><select className="input" name="length" defaultValue="standard">
                <option value="concise">Concise</option>
                <option value="standard">Standard</option>
              </select></label>
              <label><span className="muted">Why this company (optional)</span><textarea
                className="input"
                name="company_interest_notes"
                rows={4}
                style={{ paddingTop: 14 }}
              /></label>
              <button className="button secondary" disabled={busy || !ready}>Create review draft</button>
            </form>
          </article>
        </section>
      )}

      <p className="notice" role="status" aria-live="polite" style={{ marginTop: 18 }}>{message}</p>

      {documentResult && (
        <section className="stack" style={{ marginTop: 24 }}>
          <div className="section-heading">
            <div><span className="eyebrow">Generated package</span><h2 style={{ marginTop: 14 }}>Private, traceable artifacts.</h2></div>
            <p>{selected ? `${proposalLabel(selected)} · ` : ''}{TEMPLATES[documentResult.document.template_key as TemplateKey]?.label ?? documentResult.document.template_key} · checksum {documentResult.document.checksum.slice(0, 14)}…</p>
          </div>
          <div className="grid">
            {documentResult.artifacts.map((artifact) => (
              <article className="card" key={artifact.format}>
                <h3>{artifact.format.toUpperCase()}</h3>
                <div className="metric">
                  {artifact.byte_size === null
                    ? <span className="muted">Ready to download</span>
                    : <><strong>{Math.ceil(artifact.byte_size / 1024)}</strong><span className="muted">KB</span></>}
                </div>
                <button className="button secondary" type="button" disabled={downloadingFormat === artifact.format} onClick={() => void downloadArtifact(artifact)}>
                  {downloadingFormat === artifact.format ? 'Downloading…' : 'Download'}
                </button>
              </article>
            ))}
          </div>
          {documentResult.coverage && (
            <div className="grid">
              <article className="card"><h3>Required coverage</h3><div className="metric"><strong>{documentResult.coverage.required_percent}%</strong></div></article>
              <article className="card"><h3>Preferred coverage</h3><div className="metric"><strong>{documentResult.coverage.preferred_percent}%</strong></div></article>
              <article className="card"><h3>Unsupported</h3><p>{documentResult.coverage.unsupported.join(', ') || 'None'}</p></article>
            </div>
          )}
        </section>
      )}

      {coverLetter && (
        <section style={{ marginTop: 36 }}>
          <div className="section-heading">
            <div><span className="eyebrow">Sentence review</span><h2 style={{ marginTop: 14 }}>Keep every statement under your control.</h2></div>
          </div>
          <div className="stack">
            {coverLetter.changes.map((change) => (
              <article className="card" key={change.id}>
                <span className="pill">Paragraph {change.position + 1} · {change.status}</span>
                <p style={{ marginTop: 18, color: 'var(--text)', fontSize: 18 }}>{change.edited_text || change.proposed_text}</p>
                <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                  <button className="button" onClick={() => decide(change.id, 'accepted')}>Accept</button>
                  <button className="button secondary" onClick={() => decide(change.id, 'rejected')}>Reject</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
