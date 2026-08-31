'use client';

import { FormEvent, useState } from 'react';

const API = '/api/kall';

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

export default function GenerateTab() {
  const [documentResult, setDocumentResult] = useState<DocumentResult | null>(null);
  const [coverLetter, setCoverLetter] = useState<CoverLetterResult | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState<string | null>(null);

  async function generateResume(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('Generating your tailored document…');
    const form = new FormData(event.currentTarget);
    const proposalId = form.get('proposal_id');
    const templateKey = form.get('template_key');
    try {
      const response = await fetch(`${API}/tailoring/${proposalId}/documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ template_key: templateKey }),
      });
      const generated = await response.json();
      if (!response.ok) throw new Error(generated.detail || 'Generation failed');
      const detail = await fetch(`${API}/documents/${generated.id}`);
      setDocumentResult(await detail.json());
      setMessage('Resume package generated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Generation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function generateCoverLetter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const proposalId = form.get('proposal_id');
    try {
      const response = await fetch(`${API}/tailoring/${proposalId}/cover-letter`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emphasis: form.get('emphasis'),
          tone: form.get('tone'),
          length: form.get('length'),
          company_interest_notes: form.get('company_interest_notes'),
        }),
      });
      const proposal = await response.json();
      if (!response.ok) throw new Error(proposal.detail || 'Cover letter generation failed');
      const detail = await fetch(`${API}/cover-letters/${proposal.id}`);
      setCoverLetter(await detail.json());
      setMessage('Cover letter draft is ready for review.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Cover letter generation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function decide(changeId: number, decision: 'accepted' | 'rejected') {
    const response = await fetch(`${API}/cover-letter-changes/${changeId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
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
      const response = await fetch(
        `${API}/documents/${documentResult.document.id}/download/${artifact.format}`,
        { },
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

  return (
    <>
      <section className="grid">
        <article className="card">
          <h2>Generate resume package</h2>
          <p style={{ marginBottom: 20 }}>
            The tailoring proposal must be fully reviewed and finalized first.
          </p>
          <form className="form" onSubmit={generateResume}>
            <label>
              <span className="muted">Tailoring proposal ID</span>
              <input className="input" name="proposal_id" inputMode="numeric" required />
            </label>
            <label>
              <span className="muted">ATS-safe template</span>
              <select className="input" name="template_key" defaultValue="standard">
                <option value="standard">Standard professional</option>
                <option value="executive">Executive</option>
                <option value="technical-leadership">Technical leadership</option>
                <option value="compact">Compact two-page</option>
              </select>
            </label>
            <button className="button" disabled={busy}>Generate files</button>
          </form>
        </article>

        <article className="card">
          <h2>Draft grounded cover letter</h2>
          <form className="form" onSubmit={generateCoverLetter}>
            <label><span className="muted">Tailoring proposal ID</span><input className="input" name="proposal_id" required /></label>
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
            <button className="button secondary" disabled={busy}>Create review draft</button>
          </form>
        </article>
      </section>

      <p className="notice" aria-live="polite" style={{ marginTop: 18 }}>{message}</p>

      {documentResult && (
        <section className="stack" style={{ marginTop: 24 }}>
          <div className="section-heading">
            <div><span className="eyebrow">Generated package</span><h2 style={{ marginTop: 14 }}>Private, traceable artifacts.</h2></div>
            <p>Checksum {documentResult.document.checksum.slice(0, 14)}… · Template {documentResult.document.template_key}</p>
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
