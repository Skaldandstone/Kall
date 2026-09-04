'use client';

import { useEffect, useState } from 'react';

const API = '/api/kall';
const QUIZ_SIZE = 5;

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
type GradeResult = { score_percent: number; feedback: string; missed_points: string[]; additional_resources: string[] };

function groupByStage(items: QuestionToAsk[]): [string, QuestionToAsk[]][] {
  const groups = new Map<string, QuestionToAsk[]>();
  for (const item of items) {
    const list = groups.get(item.stage) || [];
    list.push(item);
    groups.set(item.stage, list);
  }
  return Array.from(groups.entries());
}

// Retaking the quiz should feel different each time -- sample a fresh
// combination from the (deliberately larger) question bank instead of
// always asking the same fixed set in the same order.
function sampleQuestions(pool: QuestionBankItem[], count: number): QuestionBankItem[] {
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

export default function InterviewPrepPanel({ applicationId, interviewStage }: { applicationId: string; interviewStage: boolean }) {
  const [prep, setPrep] = useState<Prep | null>(null);
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('Loading interview prep…');
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const [quizQuestions, setQuizQuestions] = useState<QuestionBankItem[] | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<string[]>([]);
  const [quizSubmitting, setQuizSubmitting] = useState(false);
  const [quizResults, setQuizResults] = useState<GradeResult[] | null>(null);
  const [quizGraded, setQuizGraded] = useState(true);

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

  function startQuiz() {
    if (!prep) return;
    setQuizQuestions(sampleQuestions(prep.question_bank, Math.min(QUIZ_SIZE, prep.question_bank.length)));
    setQuizAnswers(new Array(Math.min(QUIZ_SIZE, prep.question_bank.length)).fill(''));
    setQuizResults(null);
    setQuizGraded(true);
  }

  function exitQuiz() {
    setQuizQuestions(null);
    setQuizAnswers([]);
    setQuizResults(null);
  }

  async function submitQuiz() {
    if (!quizQuestions) return;
    setQuizSubmitting(true);
    setMessage('Grading your answers…');
    try {
      const response = await fetch(`${API}/me/applications/${applicationId}/interview-prep/quiz/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: quizQuestions.map((item, index) => ({
            question: item.question, category: item.category, answer_prompt: item.answer_prompt,
            candidate_answer: quizAnswers[index] || '',
          })),
        }),
      });
      if (!response.ok) { setMessage('Unable to grade this attempt.'); return; }
      const body: { enabled: boolean; results: GradeResult[] } = await response.json();
      setQuizGraded(body.enabled);
      setQuizResults(body.enabled ? body.results : null);
      setMessage(body.enabled ? '' : 'AI grading is not available -- compare your answers against the guidance below instead.');
    } finally {
      setQuizSubmitting(false);
    }
  }

  if (!prep) return <section className="card" style={{ marginTop: 24 }}><p className="notice">{message}</p></section>;

  if (quizQuestions) {
    const submitted = quizResults !== null || !quizGraded;
    const average = quizResults ? Math.round(quizResults.reduce((sum, r) => sum + r.score_percent, 0) / quizResults.length) : null;
    return (
      <section className="card" style={{ marginTop: 24 }}>
        <span className="eyebrow">Practice quiz</span>
        {average !== null && <h2 style={{ marginTop: 8 }}>{average}% average</h2>}
        {!submitted && <p className="notice" style={{ marginTop: 8 }}>Answer in your own words -- guidance is only shown after you submit.</p>}
        <div className="stack" style={{ marginTop: 16 }}>
          {quizQuestions.map((item, index) => {
            const result = quizResults?.[index];
            return (
              <article className="card" key={index}>
                <span className="pill">{item.category}</span>
                {result && <span className="pill" style={{ marginLeft: 8 }}>{result.score_percent}%</span>}
                <p style={{ marginTop: 10, fontWeight: 600 }}>{item.question}</p>
                <textarea
                  className="input"
                  rows={4}
                  style={{ marginTop: 10 }}
                  value={quizAnswers[index] || ''}
                  onChange={(event) => setQuizAnswers((current) => current.map((value, i) => (i === index ? event.target.value : value)))}
                  disabled={submitted}
                  placeholder="Type your answer here."
                />
                {result && (
                  <div style={{ marginTop: 10 }}>
                    <p>{result.feedback}</p>
                    {result.missed_points.length > 0 && (
                      <p style={{ marginTop: 6 }}><strong>What was missing:</strong> {result.missed_points.join(' · ')}</p>
                    )}
                    {result.additional_resources.length > 0 && (
                      <p style={{ marginTop: 6 }}><strong>Worth reviewing:</strong> {result.additional_resources.join(' · ')}</p>
                    )}
                  </div>
                )}
                {submitted && !quizGraded && (
                  <div style={{ marginTop: 10 }}>
                    <p><strong>How to structure this:</strong> {item.answer_prompt}</p>
                    {item.resources.length > 0 && <p style={{ marginTop: 6 }}><strong>Worth reviewing:</strong> {item.resources.join(' · ')}</p>}
                  </div>
                )}
              </article>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
          {!submitted ? (
            <button className="button" type="button" onClick={() => void submitQuiz()} disabled={quizSubmitting}>
              {quizSubmitting ? 'Grading…' : 'Submit quiz'}
            </button>
          ) : (
            <button className="button" type="button" onClick={startQuiz}>Retake quiz</button>
          )}
          <button className="button ghost" type="button" onClick={exitQuiz}>Back to prep</button>
        </div>
        <p className="notice" aria-live="polite">{message}</p>
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

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ margin: 0 }}>Practice quiz</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="button" type="button" onClick={startQuiz}>Take the practice quiz</button>
          <button className="button ghost" type="button" onClick={() => void regenerate()} disabled={regenerating}>
            {regenerating ? 'Regenerating…' : 'Refresh prep'}
          </button>
        </div>
      </div>
      <p className="notice" style={{ marginTop: 8 }}>
        Answer {Math.min(QUIZ_SIZE, prep.question_bank.length)} questions in your own words and get scored feedback. Retake as many
        times as you like -- each attempt draws a different combination from the {prep.question_bank.length}-question bank.
      </p>

      <h2 style={{ marginTop: 24 }}>Study the question bank</h2>
      <p className="notice">Guidance stays hidden until you ask for it -- try recalling an answer yourself first.</p>
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
