'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import AppNav from '../../components/AppNav';
import flow from '../../components/CurrentFlow.module.css';
import { showToast } from '../../components/ToastHost';
import AutofillPanel from './AutofillPanel';
import InterviewPrepPanel from './InterviewPrepPanel';

const API = '/api/kall';

type PipelineItem = {
  id: number; stage: string; company: string; role: string; location?: string | null;
  job_url?: string | null; match_score?: number | null;
};
type Question = { id: number; prompt: string; category: string; sensitive: boolean; required: boolean };
type Answer = { id: number; question_id: number; value?: string; status: string };
type ReviewData = { review: { status: string; readiness_issues: string[] }; questions: Question[]; answers: Answer[] };
type Submission = {
  id: number; status: string; provider: string; preview_json: Record<string, unknown>;
  failure_detail?: string; manual_url?: string; application_id: number;
};

async function errorMessage(response: Response, fallback: string) {
  try {
    const payload = await response.json();
    if (typeof payload.detail === 'string') return payload.detail;
    return fallback;
  } catch { return fallback; }
}

export default function ApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const applicationId = params.id;

  const [item, setItem] = useState<PipelineItem | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'not-found' | 'error'>('loading');
  const [review, setReview] = useState<ReviewData | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [message, setMessage] = useState('');
  const [reviewState, setReviewState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);

  const loadItem = useCallback(async () => {
    try {
      const response = await fetch(`${API}/me/applications`);
      if (response.status === 401) {window.location.replace('/sign-in'); return; }
      if (!response.ok) { setLoadState('error'); return; }
      const pipeline = await response.json();
      const found = (pipeline.stages || []).flatMap((stage: { items: PipelineItem[] }) => stage.items).find((row: PipelineItem) => String(row.id) === applicationId);
      if (!found) { setLoadState('not-found'); return; }
      setItem(found);
      setLoadState('ready');
    } catch { setLoadState('error'); }
  }, [applicationId]);

  const loadReview = useCallback(async () => {
    setReviewState('loading');
    try {
      const prepared = await fetch(`${API}/applications/${applicationId}/review`, { method: 'POST' });
      if (!prepared.ok) throw new Error(await errorMessage(prepared, 'Unable to prepare the review checklist.'));
      const response = await fetch(`${API}/applications/${applicationId}/review`);
      if (!response.ok) throw new Error(await errorMessage(response, 'Unable to load the review checklist.'));
      setReview(await response.json());
      setReviewState('ready');
    } catch (error) {
      setReviewState('error');
      setMessage(error instanceof Error ? error.message : 'Unable to load the review checklist.');
    }
  }, [applicationId]);

  const loadSubmission = useCallback(async () => {
    try {
      const list = await fetch(`${API}/submissions`);
      if (!list.ok) return;
      const submissions: Submission[] = await list.json();
      const existing = submissions.find((row) => String(row.application_id) === applicationId);
      if (existing) setSubmission(existing);
    } catch { setMessage('Unable to load the submission preview. Try again before continuing.'); }
  }, [applicationId]);

  useEffect(() => {
    void loadItem();
  }, [loadItem]);

  useEffect(() => {
    if (!item) return;
    if (item.stage === 'review') void loadReview();
    if (item.stage === 'approved' || item.stage === 'submitted') void loadSubmission();
  }, [item, loadReview, loadSubmission]);

  async function runAction(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try { await action(); }
    catch { showToast('Kall could not save that action. Your entries are still here. Please try again.', 'error'); }
    finally { setBusy(false); }
  }

  async function decide(answer: Answer, decision: string) {
    const input = document.getElementById(`answer-${answer.id}`) as HTMLTextAreaElement | null;
    const response = await fetch(`${API}/applications/${applicationId}/answers/${answer.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: input?.value || '', value_json: {}, decision }),
    });
    if (response.ok) { showToast('Answer decision saved.', 'success'); await loadReview(); }
    else showToast(await errorMessage(response, 'Unable to save answer.'), 'error');
  }

  async function confirmAll() {
    const response = await fetch(`${API}/applications/${applicationId}/review`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documents_confirmed: true, answers_confirmed: true, sensitive_fields_confirmed: true, attestations_confirmed: true }),
    });
    showToast(response.ok ? 'Review confirmations saved.' : await errorMessage(response, 'Unable to confirm review.'), response.ok ? 'success' : 'error');
    if (response.ok) await loadReview();
  }

  async function approve() {
    const response = await fetch(`${API}/applications/${applicationId}/review/approve`, { method: 'POST' });
    if (response.ok) { showToast('Application approved. Preparing the submission preview…', 'success'); await loadItem(); }
    else showToast(await errorMessage(response, 'Complete every review item before approval.'), 'error');
  }

  async function prepareSubmission() {
    const response = await fetch(`${API}/applications/${applicationId}/submission-preview`, { method: 'POST' });
    if (!response.ok) { showToast(await errorMessage(response, 'Unable to prepare a submission preview.'), 'error'); return; }
    setSubmission(await response.json());
    setMessage('Immutable preview prepared. Review every field before confirming.');
  }

  async function confirmSubmission() {
    if (!submission) return;
    const response = await fetch(`${API}/submissions/${submission.id}/confirm`, { method: 'POST' });
    const body = await response.json();
    setSubmission(body);
    setMessage(body.status === 'confirmed' ? 'Submission confirmed. A fresh attempt may now be created.' : body.failure_detail || 'Submission blocked.');
  }

  async function attemptSubmission() {
    if (!submission) return;
    const response = await fetch(`${API}/submissions/${submission.id}/attempt`, { method: 'POST' });
    if (response.ok) {
      // A successful attempt moves both the submission and its Application to
      // Submitted server-side -- reload both so the card leaves the
      // pre-submission stage instead of looking stuck.
      await Promise.all([
        fetch(`${API}/submissions/${submission.id}`).then((r) => r.ok && r.json()).then((body) => body && setSubmission(body.submission)),
        loadItem(),
      ]);
    }
    showToast(response.ok ? 'Idempotent submission attempt created. Provider transport remains controlled by the connector adapter.' : await errorMessage(response, 'A fresh confirmation is required.'), response.ok ? 'success' : 'error');
  }

  if (loadState === 'loading') return <main className={`app-shell ${flow.shell}`}><AppNav current="applications" /><section className="hero"><p className="eyebrow">Application</p><h1>Loading…</h1></section></main>;
  if (loadState === 'not-found') return <main className={`app-shell ${flow.shell}`}><AppNav current="applications" /><section className="hero"><p className="eyebrow">Application</p><h1>This application couldn't be found.</h1><p>It may have been removed.</p></section><a className="button" href="/applications">Back to pipeline</a></main>;
  if (loadState === 'error' || !item) return <main className={`app-shell ${flow.shell}`}><AppNav current="applications" /><section className="hero"><p className="eyebrow">Application</p><h1>Something went wrong loading this application.</h1><p role="alert">Your application has not been changed.</p></section><button className="button" onClick={() => { setLoadState('loading'); void loadItem(); }}>Try again</button> <a className="button secondary" href="/applications">Back to pipeline</a></main>;

  return <main className={`app-shell ${flow.shell}`}>
    <AppNav current="applications" />
    <section className="hero" style={{ paddingBottom: 30 }}>
      <span className="eyebrow">{item.company}{item.location ? ` · ${item.location}` : ''}</span>
      <h1>{item.role}</h1>
      <p>{item.match_score == null ? '' : `${item.match_score}% match · `}Stage: {item.stage}</p>
    </section>

    {item.stage === 'preparing' && <section className="card"><h2>Still being prepared.</h2><p>Kall hasn't finished assembling this application's documents yet. Check back shortly, or start a fresh preparation from Opportunities.</p></section>}

    {item.stage === 'review' && <div className="stack">
      <section className="card" aria-busy={reviewState === 'loading'}><span className="eyebrow">Readiness</span><div className="metric"><strong>{reviewState === 'ready' ? review?.review.status : reviewState === 'error' ? 'Review unavailable' : 'Loading review…'}</strong></div><p role={reviewState === 'error' ? 'alert' : 'status'}>{reviewState === 'ready' ? review?.review.readiness_issues?.join(' · ') || 'All required review items are complete.' : reviewState === 'error' ? message : 'Checking the required documents and answers before approval.'}</p>{reviewState === 'error' && <button className="button secondary" onClick={() => void loadReview()}>Retry review</button>}</section>
      {review?.questions.map((question) => {
        const answer = review.answers.find((row) => row.question_id === question.id);
        return answer ? (
          <article className="card" key={question.id}>
            <span className="pill">{question.sensitive ? 'Sensitive: confirm' : question.category}</span>
            <h2 id={`question-${question.id}`} style={{ marginTop: 16 }}>{question.prompt}</h2>
            <textarea id={`answer-${answer.id}`} aria-labelledby={`question-${question.id}`} className="input" rows={4} style={{ paddingBlock: 12, resize: 'vertical' }} defaultValue={answer.value || ''} disabled={busy} />
            <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              <button className="button" disabled={busy || reviewState !== 'ready'} onClick={() => void runAction(() => decide(answer, 'accepted'))}>Accept</button>
              <button className="button secondary" disabled={busy || reviewState !== 'ready'} onClick={() => void runAction(() => decide(answer, 'edited'))}>Save edit</button>
              <button className="button ghost" disabled={busy || reviewState !== 'ready'} onClick={() => void runAction(() => decide(answer, 'rejected'))}>Reject</button>
            </div>
          </article>
        ) : null;
      })}
      <section className="card">
        <h2>Final confirmation</h2>
        <p>Confirm the final documents, all answers, sensitive fields, and legal attestations before approving.</p>
        <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
          <button className="button secondary" disabled={busy || reviewState !== 'ready'} onClick={() => void runAction(confirmAll)}>Confirm review items</button>
          <button className="button" disabled={busy || reviewState !== 'ready'} onClick={() => void runAction(approve)}>Approve application package</button>
        </div>
      </section>
    </div>}

    {(item.stage === 'approved' || item.stage === 'submitted') && <div className="stack">
      <AutofillPanel applicationId={applicationId} />
      {item.stage === 'submitted' && <InterviewPrepPanel applicationId={applicationId} />}
      {!submission && <section className="card"><p>No submission preview exists yet for this application.</p><button className="button" onClick={() => void prepareSubmission()}>Prepare immutable preview</button><p className="notice" aria-live="polite">{message}</p></section>}
      {submission && <section className="card">
        <span className="pill">{submission.provider}</span>
        <h2 style={{ marginTop: 16 }}>{submission.status}</h2>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(submission.preview_json, null, 2)}</pre>
        {submission.failure_detail && <p className="notice">{submission.failure_detail}</p>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="button secondary" onClick={() => void confirmSubmission()}>Confirm exact preview</button>
          <button className="button" onClick={() => void attemptSubmission()} disabled={submission.status !== 'confirmed'}>Create submission attempt</button>
          {submission.manual_url && <a className="button ghost" href={submission.manual_url}>Open manual application</a>}
        </div>
        <p className="notice" aria-live="polite">{message}</p>
      </section>}
    </div>}

    {(item.stage === 'closed' || item.stage === 'rejected') && <section className="card"><h2>This application is {item.stage}.</h2><p>No further action is needed here.</p></section>}

    <p style={{ marginTop: 24 }}><a className="text-link" href="/applications">← Back to pipeline</a></p>
  </main>;
}
