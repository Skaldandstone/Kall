'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { showToast } from '../../components/ToastHost';

const API = '/api/kall';

type TailoringChange = {
  id: number;
  section: string;
  original_text: string;
  proposed_text: string;
  edited_text?: string | null;
  reason: string;
  evidence: Array<{ type?: string; id?: number; text?: string; employer?: string; title?: string; requirement?: string }>;
  status: string;
};

const ROLE_PREFIX = 'role:';
const RESUME_TEMPLATES = [
  { key: 'standard', label: 'Classic chronological', use: 'A familiar structure for most roles and industries.' },
  { key: 'executive', label: 'Leadership and impact', use: 'For senior leaders whose scope, decisions, and outcomes should lead.' },
  { key: 'creative', label: 'Creative and portfolio', use: 'For art, design, writing, performance, and other portfolio-backed work.' },
  { key: 'commercial', label: 'Sales and customer outcomes', use: 'For sales, account management, fundraising, and customer-facing work.' },
  { key: 'service', label: 'Service, hospitality, and skilled work', use: 'For culinary, hospitality, retail, trades, operations, and hands-on roles.' },
  { key: 'early', label: 'Early career and career change', use: 'For transferable skills, training, projects, and emerging experience.' },
  { key: 'compact', label: 'Compact two-page', use: 'For long work histories that need a concise, scan-friendly structure.' },
] as const;

type CoverLetterChange = {
  id: number;
  position: number;
  proposed_text: string;
  edited_text?: string | null;
  status: string;
};

type Artifact = { id: number | null; format: string; byte_size: number | null };
type ResumeLayout = {
  name: string;
  contact: string[];
  sections: Array<{
    key: string;
    title: string;
    paragraphs?: string[];
    bullets?: string[];
    groups?: Array<{ label: string; items: string[] }>;
    entries?: Array<{ title: string; organization: string; location: string; dates: string; bullets: string[] }>;
  }>;
};
type GeneratedDocument = {
  document: { id: number; template_key: string; checksum: string; content_json: { sections: Array<{ section: string; text: string }>; layout?: ResumeLayout } };
  artifacts: Artifact[];
};

function ResumePreview({ layout }: { layout: ResumeLayout }) {
  return <div className="resume-preview" style={{ marginTop: 12, padding: '20px 24px', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-raised)' }}>
    <h3 style={{ margin: 0, fontSize: 22 }}>{layout.name}</h3>
    {layout.contact.length ? <p style={{ margin: '2px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>{layout.contact.join('  •  ')}</p> : null}
    {layout.sections.map((section) => <section key={section.key} style={{ marginTop: 16 }}>
      <h4 style={{ margin: '0 0 6px', paddingBottom: 2, borderBottom: '1px solid var(--accent)', color: 'var(--accent)', fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{section.title}</h4>
      {(section.paragraphs ?? []).map((paragraph, index) => <p key={index} style={{ margin: '0 0 6px' }}>{paragraph}</p>)}
      {section.bullets?.length ? <ul style={{ margin: '0 0 6px', paddingLeft: 18 }}>{section.bullets.map((item, index) => <li key={index}>{item}</li>)}</ul> : null}
      {(section.groups ?? []).map((group) => <p key={group.label} style={{ margin: '0 0 4px' }}><strong>{group.label}:</strong> {group.items.join(', ')}</p>)}
      {(section.entries ?? []).map((entry, index) => <div key={index} style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><strong>{entry.title}</strong>{entry.dates ? <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{entry.dates}</span> : null}</div>
        {entry.organization || entry.location ? <div style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>{[entry.organization, entry.location].filter(Boolean).join(' — ')}</div> : null}
        {entry.bullets.length ? <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{entry.bullets.map((item, bulletIndex) => <li key={bulletIndex}>{item}</li>)}</ul> : null}
      </div>)}
    </section>)}
  </div>;
}

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
  // Same reasoning as tailoringChangesLoaded above, for the cover letter's
  // own fetch.
  const [coverLetterChangesLoaded, setCoverLetterChangesLoaded] = useState(false);
  const [document_, setDocument_] = useState<GeneratedDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState<string | null>(null);
  const [templateKey, setTemplateKey] = useState<string>('standard');
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [finalPreview, setFinalPreview] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);

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
      if (!stale()) setCoverLetterChangesLoaded(true);
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

  // Each look, as the person's own first page, once the text is final.
  const readyForPreviews = Boolean(payload?.tailoring_proposal_id) && tailoringDone && coverLetterDone && !document_;
  useEffect(() => {
    if (!readyForPreviews || !payload?.tailoring_proposal_id) return;
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      for (const template of RESUME_TEMPLATES) {
        if (cancelled) return;
        const response = await fetch(`${API}/tailoring/${payload.tailoring_proposal_id}/previews/${template.key}.png`).catch(() => null);
        if (!response?.ok || cancelled) continue;
        const url = URL.createObjectURL(await response.blob());
        urls.push(url);
        setPreviews((current) => ({ ...current, [template.key]: url }));
      }
    })();
    return () => { cancelled = true; urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [readyForPreviews, payload?.tailoring_proposal_id]);

  useEffect(() => {
    if (!document_) { setFinalPreview(null); return; }
    let cancelled = false;
    let url: string | null = null;
    fetch(`${API}/documents/${document_.document.id}/preview.png`)
      .then(async (response) => { if (response.ok && !cancelled) { url = URL.createObjectURL(await response.blob()); setFinalPreview(url); } })
      .catch(() => undefined);
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [document_]);

  const roleGroups = useMemo(() => {
    const groups: Record<string, { key: string; title: string; employer: string; changes: TailoringChange[] }> = {};
    for (const change of tailoringChanges) {
      if (!change.section.startsWith(ROLE_PREFIX)) continue;
      const group = groups[change.section] ?? { key: change.section, title: String(change.evidence[0]?.title ?? 'Role'), employer: String(change.evidence[0]?.employer ?? ''), changes: [] };
      group.changes.push(change);
      groups[change.section] = group;
    }
    return Object.values(groups);
  }, [tailoringChanges]);
  const otherChanges = tailoringChanges.filter((change) => !change.section.startsWith(ROLE_PREFIX));
  const rolePending = tailoringChanges.filter((change) => change.section.startsWith(ROLE_PREFIX) && change.status === 'pending').length;

  async function reviewAll(status: 'accepted' | 'rejected', prefix?: string) {
    if (!payload?.tailoring_proposal_id) return;
    setBusy(true);
    try {
      const response = await fetch(`${API}/tailoring/proposals/${payload.tailoring_proposal_id}/review-all`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, section_prefix: prefix ?? null }),
      });
      if (!response.ok) { showToast(await errorMessage(response, 'Unable to update those suggestions.'), 'error'); return; }
      const data = await response.json() as { reviewed: number; changes: TailoringChange[] };
      setTailoringChanges((current) => current.map((item) => data.changes.find((updated) => updated.id === item.id) ?? item));
      showToast(status === 'accepted' ? `Approved ${data.reviewed} suggestions.` : `Skipped ${data.reviewed} suggestions.`, 'success');
    } finally { setBusy(false); }
  }

  async function saveToProfile() {
    if (!document_) return;
    setBusy(true);
    try {
      const response = await fetch(`${API}/documents/${document_.document.id}/save-to-profile`, { method: 'POST' });
      if (!response.ok) { showToast(await errorMessage(response, 'Unable to save this resume to your profile.'), 'error'); return; }
      const data = await response.json() as { resume: { name: string } };
      setSavedName(data.resume.name);
      showToast(`Saved to your resumes as ${data.resume.name}.`, 'success');
    } finally { setBusy(false); }
  }

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
        body: JSON.stringify({ template_key: templateKey }),
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
        <h2 style={{ marginTop: 16 }}>{tailoringStatus === 'finalized' ? 'Your answers are in.' : 'Step 1 of 3 · Answer what each role is missing.'}</h2>
        {tailoringStatus === 'finalized' ? <p className="notice">{tailoringChanges.filter((change) => change.status !== 'rejected').length} approved, {tailoringChanges.filter((change) => change.status === 'rejected').length} skipped. Nothing was written into your resume without your approval.</p> : (
          <div className="stack" style={{ marginTop: 16 }}>
            {otherChanges.filter((change) => change.section === 'summary').map((change) => (
              <article className="card" key={change.id}>
                <span className="pill">Opening summary</span>
                <h3 style={{ marginTop: 12 }}>{change.reason}</h3>
                <div className="two">
                  <div><h4>Original</h4><p>{change.original_text}</p></div>
                  <div><h4>Proposed</h4><textarea className="input" id={`app-tailoring-${change.id}`} defaultValue={change.edited_text || change.proposed_text} rows={6} disabled={busy || change.status !== 'pending'} /></div>
                </div>
                {change.status === 'pending' ? <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                  <button className="button" disabled={busy} onClick={() => void decideTailoring(change, 'accepted')}>Accept</button>
                  <button className="button secondary" disabled={busy} onClick={() => void decideTailoring(change, 'edited', (window.document.getElementById(`app-tailoring-${change.id}`) as HTMLTextAreaElement).value)}>Save edit</button>
                  <button className="button ghost" disabled={busy} onClick={() => void decideTailoring(change, 'rejected')}>Reject</button>
                </div> : <p className="notice">Status: {change.status}</p>}
              </article>
            ))}

            {roleGroups.length > 0 && (
              <article className="card">
                <span className="pill">What each role is missing</span>
                <p style={{ marginTop: 12 }}>For every job on your record, Kall lists what this posting asks for that the job does not show yet, and drafts a bullet you could add. Approve only what is true. Where you see [X], put in the real figure.</p>
                {rolePending > 0 && <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                  <button className="button" disabled={busy} onClick={() => void reviewAll('accepted', ROLE_PREFIX)}>Approve all {rolePending}</button>
                  <button className="button ghost" disabled={busy} onClick={() => void reviewAll('rejected', ROLE_PREFIX)}>Skip all</button>
                </div>}
              </article>
            )}

            {roleGroups.map((group) => (
              <article className="card" key={group.key}>
                <span className="pill">{group.title}{group.employer ? ` · ${group.employer}` : ''}</span>
                {group.changes.map((change) => (
                  <div key={change.id} style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><strong>{String(change.evidence[0]?.requirement ?? 'Requirement')}</strong><span className="notice">{change.status === 'pending' ? 'Needs your answer' : change.status === 'rejected' ? 'Skipped' : 'Approved'}</span></div>
                    <p style={{ margin: '6px 0' }}>{change.reason}</p>
                    <h4>Suggested bullet</h4>
                    {change.status === 'pending'
                      ? <textarea className="input" id={`app-tailoring-${change.id}`} defaultValue={change.edited_text || change.proposed_text} rows={3} disabled={busy} />
                      : <p style={{ textDecoration: change.status === 'rejected' ? 'line-through' : undefined, color: change.status === 'rejected' ? 'var(--text-secondary)' : undefined }}>{change.edited_text || change.proposed_text}</p>}
                    {change.status === 'pending' && <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                      <button className="button" disabled={busy} onClick={() => { const value = (window.document.getElementById(`app-tailoring-${change.id}`) as HTMLTextAreaElement).value; void decideTailoring(change, value.trim() !== change.proposed_text ? 'edited' : 'accepted', value); }}>Yes, add it</button>
                      <button className="button ghost" disabled={busy} onClick={() => void decideTailoring(change, 'rejected')}>Not true, skip</button>
                    </div>}
                  </div>
                ))}
              </article>
            ))}

            {otherChanges.filter((change) => change.section !== 'summary').map((change) => (
              <article className="card" key={change.id}>
                <span className="pill">{change.section}</span>
                <h3 style={{ marginTop: 12 }}>{change.reason}</h3>
                <p>{change.edited_text || change.proposed_text}</p>
                {change.status === 'pending' ? <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                  <button className="button" disabled={busy} onClick={() => void decideTailoring(change, 'accepted')}>Keep</button>
                  <button className="button ghost" disabled={busy} onClick={() => void decideTailoring(change, 'rejected')}>Leave out</button>
                </div> : <p className="notice">Status: {change.status}</p>}
              </article>
            ))}

            <button className="button" disabled={busy || !tailoringChangesLoaded || tailoringChanges.some((change) => change.status === 'pending')} onClick={() => void finalizeTailoring()}>Continue to pick a look</button>
            {!tailoringChangesLoaded && <p className="notice">Loading the proposed changes…</p>}
            {tailoringChangesLoaded && tailoringChanges.some((change) => change.status === 'pending') && <p className="notice">Answer every suggestion above first — approve, edit, or skip.</p>}
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
            <button className="button" disabled={busy || !coverLetterChangesLoaded || coverLetterChanges.some((change) => change.status === 'pending')} onClick={() => void finalizeCoverLetter()}>Finalize cover letter</button>
            {!coverLetterChangesLoaded && <p className="notice">Loading the cover letter…</p>}
            {coverLetterChangesLoaded && coverLetterChanges.some((change) => change.status === 'pending') && <p className="notice">Every paragraph above must be accepted or rejected first.</p>}
          </div>
        )}
      </section>
    )}

    {tailoringDone && coverLetterDone && (
      <section className="card">
        <span className="eyebrow">{document_ ? 'Step 3 of 3 · Your new resume' : 'Step 2 of 3 · Pick a look'}</span>
        {!document_ ? (
          <>
            <h2 style={{ marginTop: 16 }}>Choose how it should look.</h2>
            <p>Each sample is your own resume, with the approved changes, in that layout. All are single column and ATS-readable.</p>
            <div role="radiogroup" aria-label="Resume layouts" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14, marginTop: 12 }}>
              {RESUME_TEMPLATES.map((template) => {
                const active = templateKey === template.key;
                return <button type="button" role="radio" aria-checked={active} key={template.key} onClick={() => setTemplateKey(template.key)} style={{ textAlign: 'left', padding: 10, borderRadius: 12, border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'var(--surface-raised)' : 'transparent', cursor: 'pointer' }}>
                  {previews[template.key]
                    ? <img src={previews[template.key]} alt={`${template.label} sample`} style={{ width: '100%', aspectRatio: '0.773', objectFit: 'cover', objectPosition: 'top', borderRadius: 6, background: '#fff', display: 'block' }} />
                    : <div aria-hidden style={{ width: '100%', aspectRatio: '0.773', borderRadius: 6, background: 'var(--surface-raised)' }} />}
                  <strong style={{ display: 'block', marginTop: 8 }}>{template.label}</strong>
                  <small style={{ color: 'var(--text-secondary)' }}>{template.use}</small>
                </button>;
              })}
            </div>
            <button className="button" style={{ marginTop: 16 }} disabled={busy} onClick={() => void generateFinalDocuments()}>Build my resume in this look</button>
          </>
        ) : (
          <>
            <h2 style={{ marginTop: 16 }}>Read exactly what will be sent.</h2>
            {finalPreview && <img src={finalPreview} alt="First page of your new resume" style={{ width: '100%', maxWidth: 560, borderRadius: 8, border: '1px solid var(--border)', background: '#fff', display: 'block', marginTop: 12 }} />}
            {document_.document.content_json.layout ? <ResumePreview layout={document_.document.content_json.layout} /> : (
              <div className="stack" style={{ marginTop: 12 }}>
                {document_.document.content_json.sections.map((section, index) => (
                  <div key={index}><h4>{section.section.replace(/_/g, ' ')}</h4><p style={{ whiteSpace: 'pre-wrap' }}>{section.text}</p></div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              {document_.artifacts.filter((artifact) => artifact.format !== 'txt').map((artifact) => (
                <button className="button secondary" key={artifact.format} disabled={downloadingFormat === artifact.format} onClick={() => void downloadArtifact(artifact)}>
                  {downloadingFormat === artifact.format ? 'Downloading…' : `Export ${artifact.format === 'docx' ? 'Word' : artifact.format.toUpperCase()}`}
                </button>
              ))}
              <button className="button" disabled={busy || savedName !== null} onClick={() => void saveToProfile()}>{savedName ? 'Saved to my resumes' : 'Save to my resumes'}</button>
              <button className="button ghost" disabled={busy} onClick={() => { setDocument_(null); setSavedName(null); }}>Try a different look</button>
            </div>
          </>
        )}
      </section>
    )}
  </div>;
}
