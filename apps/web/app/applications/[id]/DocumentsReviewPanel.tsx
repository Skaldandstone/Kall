'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { showToast } from '../../components/ToastHost';

const API = '/api/kall';

type TailoringChange = {
  id: number;
  section: string;
  original_text: string;
  proposed_text: string;
  edited_text?: string | null;
  reason: string;
  evidence: Array<{ type: string; id: number; text: string }>;
  status: string;
};

type CoverLetterChange = {
  id: number;
  position: number;
  proposed_text: string;
  edited_text?: string | null;
  status: string;
};

type Artifact = { id: number | null; format: string; byte_size: number | null };
type GeneratedDocument = {
  document: { id: number; template_key: string; checksum: string; content_json: { sections: Array<{ section: string; text: string }> } };
  artifacts: Artifact[];
};

type PreparedPayload = {
  tailoring_proposal_id?: number | null;
  cover_letter_proposal_id?: number | null;
  generated_document_id?: number | null;
  customize_resume?: boolean;
  generate_cover_letter?: boolean;
};

async function errorMessage(response: Response, fallback: string) {
  try {
    const payload = await response.json();
    return typeof payload.detail === 'string' ? payload.detail : fallback;
  } catch { return fallback; }
}

async function linkDocuments(applicationId: string, links: Partial<PreparedPayload>) {
  await fetch(`${API}/applications/${applicationId}/generated-documents`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(links),
  });
}

export default function DocumentsReviewPanel({ applicationId, onReady }: { applicationId: string; onReady: (ready: boolean) => void }) {
  const [payload, setPayload] = useState<PreparedPayload | null>(null);
  const [tailoringStatus, setTailoringStatus] = useState('');
  const [tailoringChanges, setTailoringChanges] = useState<TailoringChange[]>([]);
  // tailoringChanges starts empty, same as "everything is already accepted"
  // to `.some(status === 'pending')` -- so before the fetch below resolves,
  // "Finalize resume tailoring" reads as safe to click when it is really
  // just not loaded yet. A CI run caught exactly this: the button was
  // clicked before its own pending change had arrived, and the server
  // correctly 422'd. This flag closes that window.
  const [tailoringChangesLoaded, setTailoringChangesLoaded] = useState(false);
  const [coverLetterStatus, setCoverLetterStatus] = useState('');
  const [coverLetterChanges, setCoverLetterChanges] = useState<CoverLetterChange[]>([]);
  const [document_, setDocument_] = useState<GeneratedDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState<string | null>(null);

  // React 18 Strict Mode (development only) double-invokes this effect on
  // mount, firing two overlapping load() calls. Without a sequence guard,
  // whichever of the two happens to resolve last wins -- including a stale
  // first call resolving after a real user action (accepting a tailoring
  // change, say) has already moved local state past it, silently reverting
  // that action's effect. loadSeq makes only the most recently *started*
  // load() actually allowed to commit state, however its requests interleave.
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const stale = () => seq !== loadSeq.current;

    const response = await fetch(`${API}/applications/${applicationId}`);
    if (!response.ok || stale()) return;
    const application = await response.json();
    const prepared: PreparedPayload = application.prepared_payload || {};
    if (stale()) return;
    setPayload(prepared);

    if (prepared.tailoring_proposal_id) {
      const proposalResponse = await fetch(`${API}/tailoring/proposals/${prepared.tailoring_proposal_id}`);
      if (proposalResponse.ok) {
        const data = await proposalResponse.json();
        if (!stale()) {
          setTailoringChanges(data.changes);
          setTailoringStatus(data.proposal.status);
        }
      }
      if (!stale()) setTailoringChangesLoaded(true);
    }
    if (prepared.cover_letter_proposal_id) {
      const letterResponse = await fetch(`${API}/cover-letters/${prepared.cover_letter_proposal_id}`);
      if (letterResponse.ok) {
        const data = await letterResponse.json();
        if (!stale()) {
          setCoverLetterChanges(data.changes);
          setCoverLetterStatus(data.proposal.status);
        }
      }
    }
    if (prepared.generated_document_id) {
      const documentResponse = await fetch(`${API}/documents/${prepared.generated_document_id}`);
      if (documentResponse.ok && !stale()) setDocument_(await documentResponse.json());
    }
  }, [applicationId]);

  useEffect(() => { void load(); }, [load]);

  const tailoringDone = !payload?.customize_resume && !payload?.generate_cover_letter
    ? true // nothing was requested -- there is no tailoring content to review
    : !payload?.tailoring_proposal_id ? false : tailoringStatus === 'finalized';
  const coverLetterDone = !payload?.generate_cover_letter ? true : coverLetterStatus === 'finalized';
  const documentReady = document_ !== null;
  const nothingToReview = !payload?.customize_resume && !payload?.generate_cover_letter;

  useEffect(() => {
    onReady(nothingToReview || (tailoringDone && coverLetterDone && documentReady));
  }, [nothingToReview, tailoringDone, coverLetterDone, documentReady, onReady]);

  async function decideTailoring(change: TailoringChange, status: string, editedText?: string) {
    setBusy(true);
    try {
      const response = await fetch(`${API}/tailoring/changes/${change.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, edited_text: editedText || null }),
      });
      if (!response.ok) { showToast(await errorMessage(response, 'Unable to save that decision.'), 'error'); return; }
      const data = await response.json();
      setTailoringChanges((current) => current.map((item) => (item.id === data.id ? data : item)));
    } finally { setBusy(false); }
  }

  async function finalizeTailoring() {
    if (!payload?.tailoring_proposal_id) return;
    setBusy(true);
    try {
      const response = await fetch(`${API}/tailoring/proposals/${payload.tailoring_proposal_id}/finalize`, { method: 'POST' });
      if (!response.ok) { showToast(await errorMessage(response, 'Every change must be accepted, edited, or rejected first.'), 'error'); return; }
      const data = await response.json();
      setTailoringStatus(data.status);
    } finally { setBusy(false); }
  }

  async function draftCoverLetter() {
    if (!payload?.tailoring_proposal_id) return;
    setBusy(true);
    try {
      const response = await fetch(`${API}/tailoring/${payload.tailoring_proposal_id}/cover-letter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emphasis: 'balanced', tone: 'formal', length: 'standard', company_interest_notes: null }),
      });
      if (!response.ok) { showToast(await errorMessage(response, 'Unable to draft a cover letter.'), 'error'); return; }
      const proposal = await response.json();
      await linkDocuments(applicationId, { cover_letter_proposal_id: proposal.id });
      await load();
    } finally { setBusy(false); }
  }

  async function decideCoverLetter(change: CoverLetterChange, decision: 'accepted' | 'rejected') {
    setBusy(true);
    try {
      const response = await fetch(`${API}/cover-letter-changes/${change.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) { showToast(await errorMessage(response, 'Unable to save that decision.'), 'error'); return; }
      setCoverLetterChanges((current) => current.map((item) => (item.id === change.id ? { ...item, status: decision } : item)));
    } finally { setBusy(false); }
  }

  async function finalizeCoverLetter() {
    if (!payload?.cover_letter_proposal_id) return;
    setBusy(true);
    try {
      const response = await fetch(`${API}/cover-letters/${payload.cover_letter_proposal_id}/finalize`, { method: 'POST' });
      if (!response.ok) { showToast(await errorMessage(response, 'Every paragraph must be accepted or rejected first.'), 'error'); return; }
      const data = await response.json();
      setCoverLetterStatus(data.status);
    } finally { setBusy(false); }
  }

  async function generateFinalDocuments() {
    if (!payload?.tailoring_proposal_id) return;
    setBusy(true);
    try {
      const response = await fetch(`${API}/tailoring/${payload.tailoring_proposal_id}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_key: 'standard' }),
      });
      if (!response.ok) { showToast(await errorMessage(response, 'Unable to generate the final documents.'), 'error'); return; }
      const generated = await response.json();
      await linkDocuments(applicationId, { generated_document_id: generated.id });
      await load();
    } finally { setBusy(false); }
  }

  async function downloadArtifact(artifact: Artifact) {
    if (!document_) return;
    setDownloadingFormat(artifact.format);
    try {
      const response = await fetch(`${API}/documents/${document_.document.id}/download/${artifact.format}`);
      if (!response.ok) throw new Error('Unable to download this file.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = `resume.${artifact.format}`;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to download this file.', 'error');
    } finally { setDownloadingFormat(null); }
  }

  if (!payload) return null;
  if (nothingToReview) {
    return <section className="card"><span className="eyebrow">Documents</span><h2 style={{ marginTop: 16 }}>Using your original resume as-is.</h2><p>No AI customization was requested for this application.</p></section>;
  }

  return <div className="stack">
    {payload.tailoring_proposal_id && (
      <section className="card">
        <span className="eyebrow">Resume tailoring</span>
        <h2 style={{ marginTop: 16 }}>Review every proposed change before it's used.</h2>
        {tailoringStatus === 'finalized' ? <p className="notice">Resume tailoring finalized.</p> : (
          <div className="stack" style={{ marginTop: 16 }}>
            {tailoringChanges.map((change) => (
              <article className="card" key={change.id}>
                <span className="pill">{change.section}</span>
                <h3 style={{ marginTop: 12 }}>{change.reason}</h3>
                <div className="two">
                  <div><h4>Original</h4><p>{change.original_text}</p></div>
                  <div><h4>Proposed</h4><textarea className="input" id={`app-tailoring-${change.id}`} defaultValue={change.edited_text || change.proposed_text} rows={6} disabled={busy} /></div>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                  <button className="button" disabled={busy} onClick={() => void decideTailoring(change, 'accepted')}>Accept</button>
                  <button className="button secondary" disabled={busy} onClick={() => void decideTailoring(change, 'edited', (window.document.getElementById(`app-tailoring-${change.id}`) as HTMLTextAreaElement).value)}>Save edit</button>
                  <button className="button ghost" disabled={busy} onClick={() => void decideTailoring(change, 'rejected')}>Reject</button>
                </div>
                <p className="notice">Status: {change.status}</p>
              </article>
            ))}
            <button className="button" disabled={busy || !tailoringChangesLoaded || tailoringChanges.some((change) => change.status === 'pending')} onClick={() => void finalizeTailoring()}>Finalize resume tailoring</button>
            {!tailoringChangesLoaded && <p className="notice">Loading the proposed changes…</p>}
            {tailoringChangesLoaded && tailoringChanges.some((change) => change.status === 'pending') && <p className="notice">Every change above must be accepted, edited, or rejected first.</p>}
          </div>
        )}
      </section>
    )}

    {tailoringDone && payload.generate_cover_letter && (
      <section className="card">
        <span className="eyebrow">Cover letter</span>
        <h2 style={{ marginTop: 16 }}>Review each paragraph before it's used.</h2>
        {!payload.cover_letter_proposal_id ? (
          <button className="button" disabled={busy} onClick={() => void draftCoverLetter()}>Draft cover letter</button>
        ) : coverLetterStatus === 'finalized' ? <p className="notice">Cover letter finalized.</p> : (
          <div className="stack" style={{ marginTop: 16 }}>
            {coverLetterChanges.map((change) => (
              <article className="card" key={change.id}>
                <span className="pill">Paragraph {change.position + 1} · {change.status}</span>
                <p style={{ marginTop: 12 }}>{change.edited_text || change.proposed_text}</p>
                <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                  <button className="button" disabled={busy} onClick={() => void decideCoverLetter(change, 'accepted')}>Accept</button>
                  <button className="button secondary" disabled={busy} onClick={() => void decideCoverLetter(change, 'rejected')}>Reject</button>
                </div>
              </article>
            ))}
            <button className="button" disabled={busy || coverLetterChanges.some((change) => change.status === 'pending')} onClick={() => void finalizeCoverLetter()}>Finalize cover letter</button>
            {coverLetterChanges.some((change) => change.status === 'pending') && <p className="notice">Every paragraph above must be accepted or rejected first.</p>}
          </div>
        )}
      </section>
    )}

    {tailoringDone && coverLetterDone && (
      <section className="card">
        <span className="eyebrow">Final documents</span>
        {!document_ ? (
          <>
            <h2 style={{ marginTop: 16 }}>Generate the ATS-formatted resume.</h2>
            <button className="button" disabled={busy} onClick={() => void generateFinalDocuments()}>Generate final documents</button>
          </>
        ) : (
          <>
            <h2 style={{ marginTop: 16 }}>Read exactly what will be sent.</h2>
            <div className="stack" style={{ marginTop: 12 }}>
              {document_.document.content_json.sections.map((section, index) => (
                <div key={index}><h4>{section.section.replace(/_/g, ' ')}</h4><p style={{ whiteSpace: 'pre-wrap' }}>{section.text}</p></div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              {document_.artifacts.filter((artifact) => artifact.format !== 'txt').map((artifact) => (
                <button className="button secondary" key={artifact.format} disabled={downloadingFormat === artifact.format} onClick={() => void downloadArtifact(artifact)}>
                  {downloadingFormat === artifact.format ? 'Downloading…' : `Download ${artifact.format.toUpperCase()}`}
                </button>
              ))}
            </div>
          </>
        )}
      </section>
    )}
  </div>;
}
