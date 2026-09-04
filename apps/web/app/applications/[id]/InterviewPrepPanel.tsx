'use client';

import { useEffect, useState } from 'react';

const API = '/api/kall';

type CompanyContext = { likely_product: string; likely_tech_stack: string[]; summary: string };
type QuestionBankItem = { question: string; category: string; answer_prompt: string; resources: string[] };
type QuestionToAsk = { stage: string; question: string };
type Prep = {
  id: number;
  company_context: CompanyContext;
  question_bank: QuestionBankItem[];
  questions_to_ask: QuestionToAsk[];
  notes: string;
};

function groupByStage(items: QuestionToAsk[]): [string, QuestionToAsk[]][] {
  const groups = new Map<string, QuestionToAsk[]>();
  for (const item of items) {
    const list = groups.get(item.stage) || [];
    list.push(item);
    groups.set(item.stage, list);
  }
  return Array.from(groups.entries());
}

export default function InterviewPrepPanel({ applicationId, interviewStage }: { applicationId: string; interviewStage: boolean }) {
  const [prep, setPrep] = useState<Prep | null>(null);
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('Loading interview prep…');
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [practiceIndex, setPracticeIndex] = useState<number | null>(null);
  const [practiceAnswer, setPracticeAnswer] = useState('');
  const [practiceRevealed, setPracticeRevealed] = useState(false);

  function load() {
    setMessage('Loading interview prep…');
    fetch(`${API}/me/applications/${applicationId}/interview-prep`)
      .then(async (response) => {
        if (response.status === 401) { window.location.replace('/sign-in'); return; }
        if (!response.ok) { setMessage('Unable to load interview prep.'); return; }
        const body: Prep = await response.json();
        setPrep(body);
        setNotes(body.notes);
        setMessage('');
      })
      .catch(() => setMessage('Kall could not reach the API.'));
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [applicationId]);

  async function saveNotes() {
    setSaving(true);
    const response = await fetch(`${API}/me/applications/${applicationId}/interview-prep/notes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    });
    setSaving(false);
    setMessage(response.ok ? 'Notes saved.' : 'Unable to save notes.');
  }

  async function regenerate() {
    setRegenerating(true);
    setMessage('Generating fresh prep…');
    const response = await fetch(`${API}/me/applications/${applicationId}/interview-prep/regenerate`, { method: 'POST' });
    setRegenerating(false);
    if (!response.ok) { setMessage('Unable to regenerate prep.'); return; }
    const body: Prep = await response.json();
    setPrep(body);
    setNotes(body.notes);
    setMessage('Prep refreshed.');
  }

  function startPractice() {
    setPracticeIndex(0);
    setPracticeAnswer('');
    setPracticeRevealed(false);
  }

  function nextPractice(direction: 1 | -1) {
    if (practiceIndex === null || !prep) return;
    const next = practiceIndex + direction;
    if (next < 0 || next >= prep.question_bank.length) { setPracticeIndex(null); return; }
    setPracticeIndex(next);
    setPracticeAnswer('');
    setPracticeRevealed(false);
  }

  if (!prep) return <section className="card" style={{ marginTop: 24 }}><p className="notice">{message}</p></section>;

  if (practiceIndex !== null) {
    const current = prep.question_bank[practiceIndex];
    return (
      <section className="card" style={{ marginTop: 24 }}>
        <span className="eyebrow">Practice session</span>
        <p className="notice" style={{ marginTop: 8 }}>Question {practiceIndex + 1} of {prep.question_bank.length}</p>
        <h2 style={{ marginTop: 8 }}>{current.question}</h2>
        <span className="pill" style={{ marginTop: 8 }}>{current.category}</span>
        <textarea
          className="input"
          rows={5}
          style={{ marginTop: 16 }}
          value={practiceAnswer}
          onChange={(event) => setPracticeAnswer(event.target.value)}
          placeholder="Say or type your answer here, then reveal the prep guidance to self-check."
        />
        {!practiceRevealed ? (
          <button className="button secondary" type="button" style={{ marginTop: 12 }} onClick={() => setPracticeRevealed(true)}>
            Reveal guidance
          </button>
        ) : (
          <div style={{ marginTop: 12 }}>
            <p><strong>How to structure this:</strong> {current.answer_prompt}</p>
            {current.resources.length > 0 && (
              <p style={{ marginTop: 8 }}><strong>Worth reviewing:</strong> {current.resources.join(' · ')}</p>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
          <button className="button secondary" type="button" onClick={() => nextPractice(-1)} disabled={practiceIndex === 0}>Previous</button>
          <button className="button" type="button" onClick={() => nextPractice(1)}>
            {practiceIndex === prep.question_bank.length - 1 ? 'Finish practice' : 'Next question'}
          </button>
          <button className="button ghost" type="button" onClick={() => setPracticeIndex(null)}>Exit practice</button>
        </div>
      </section>
    );
  }

  return (
    <section className="card" style={{ marginTop: 24 }}>
      <span className="eyebrow">Interview prep</span>
      {interviewStage && <p className="notice" style={{ marginTop: 8 }}>This application is in the Interview stage -- here's what Kall put together to help you get ready.</p>}

      <h2 style={{ marginTop: 16 }}>Company context</h2>
      <p className="notice">Kall's best inference from the job posting itself, not verified research -- look the company up yourself before relying on this.</p>
      <p style={{ marginTop: 8 }}>{prep.company_context.summary}</p>
      {prep.company_context.likely_product && prep.company_context.likely_product !== 'Not available' && (
        <p style={{ marginTop: 6 }}><strong>Likely product:</strong> {prep.company_context.likely_product}</p>
      )}
      {prep.company_context.likely_tech_stack.length > 0 && (
        <div className="tags" style={{ marginTop: 8 }}>
          {prep.company_context.likely_tech_stack.map((tech) => <span className="tag" key={tech}>{tech}</span>)}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 }}>
        <h2 style={{ margin: 0 }}>Likely questions</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="button secondary" type="button" onClick={startPractice}>Start practice session</button>
          <button className="button ghost" type="button" onClick={() => void regenerate()} disabled={regenerating}>
            {regenerating ? 'Regenerating…' : 'Refresh prep'}
          </button>
        </div>
      </div>
      <div className="stack" style={{ marginTop: 12 }}>
        {prep.question_bank.map((item, index) => (
          <article className="card" key={index}>
            <span className="pill">{item.category}</span>
            <p style={{ marginTop: 10, fontWeight: 600 }}>{item.question}</p>
            {expanded === index ? (
              <>
                <p style={{ marginTop: 8 }}><strong>How to structure this:</strong> {item.answer_prompt}</p>
                {item.resources.length > 0 && <p style={{ marginTop: 6 }}><strong>Worth reviewing:</strong> {item.resources.join(' · ')}</p>}
                <button className="button ghost" type="button" style={{ marginTop: 8 }} onClick={() => setExpanded(null)}>Hide guidance</button>
              </>
            ) : (
              <button className="button ghost" type="button" style={{ marginTop: 8 }} onClick={() => setExpanded(index)}>Show guidance</button>
            )}
          </article>
        ))}
      </div>

      <h2 style={{ marginTop: 24 }}>Good questions to ask</h2>
      {groupByStage(prep.questions_to_ask).map(([stage, items]) => (
        <div key={stage} style={{ marginTop: 12 }}>
          <h3 style={{ textTransform: 'capitalize' }}>{stage}</h3>
          <ul>{items.map((item, index) => <li key={index} style={{ marginBottom: 6 }}>{item.question}</li>)}</ul>
        </div>
      ))}

      <h3 id="interview-notes-label" style={{ marginTop: 24 }}>Your notes</h3>
      <textarea
        aria-labelledby="interview-notes-label"
        className="input"
        rows={5}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Talking points, your own research, follow-up items…"
      />
      <div style={{ marginTop: 12 }}>
        <button className="button secondary" type="button" onClick={() => void saveNotes()} disabled={saving}>Save notes</button>
      </div>
      <p className="notice" aria-live="polite">{message}</p>
    </section>
  );
}
