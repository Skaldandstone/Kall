'use client';

import { FormEvent, useMemo, useState } from 'react';
import ChipsInput from '../components/ChipsInput';
import styles from './GuidedProfileBuilder.module.css';

const API = '/api/kall';
type Resume = { id: number; name: string; version: number };
type Suggestion = { profile_name?: string; target_titles?: string[]; industries?: string[]; keywords?: string[]; work_types?: string[]; suggested_salary_min?: number | null; suggested_salary_max?: number | null };
type MultiValueKey = 'target_titles' | 'industries' | 'include_keywords' | 'work_types' | 'countries' | 'states_regions';
type Draft = { name: string; target_titles: string[]; industries: string[]; include_keywords: string[]; work_types: string[]; countries: string[]; states_regions: string[]; minimum_base: string; target_base: string };

const emptyDraft = (): Draft => ({ name: '', target_titles: [], industries: [], include_keywords: [], work_types: ['remote'], countries: ['United States'], states_regions: [], minimum_base: '', target_base: '' });
const STEPS = [
  { module: 'Direction', key: 'name', label: 'What should we call this career direction?', help: 'Use a short label such as Quality Leadership or Fractional Engineering.' },
  { module: 'Direction', key: 'target_titles', label: 'Which titles should Kall look for?', help: 'Confirm close title variants that accurately reflect your experience.' },
  { module: 'Direction', key: 'industries', label: 'Which industries fit this direction?', help: 'Add each short, common industry name as its own choice.' },
  { module: 'Evidence', key: 'include_keywords', label: 'Which strengths should matching roles need?', help: 'Only keep skills and specialties your record can support.' },
  { module: 'Work fit', key: 'work_types', label: 'How do you want to work?', help: 'Examples: remote, hybrid, onsite.' },
  { module: 'Work fit', key: 'location', label: 'Where are you willing to work?', help: 'Add countries and states or regions. Leave unknown details unfinished.' },
  { module: 'Compensation', key: 'compensation', label: 'What compensation range should Kall use?', help: 'Resume suggestions are unverified estimates. Replace them with your own decision.' },
] as const;
const numberOrNull = (value: string) => value.trim() ? Number(value) : null;
const MULTI_VALUE_FIELDS: Partial<Record<(typeof STEPS)[number]['key'], { key: MultiValueKey; label: string; placeholder: string }>> = {
  target_titles: { key: 'target_titles', label: 'Confirmed titles', placeholder: 'Add another title' },
  industries: { key: 'industries', label: 'Confirmed industries', placeholder: 'Add another industry' },
  include_keywords: { key: 'include_keywords', label: 'Confirmed strengths', placeholder: 'Add another strength' },
  work_types: { key: 'work_types', label: 'Confirmed work arrangements', placeholder: 'Add remote, hybrid, or onsite' },
};

function AnswerChips({ values }: { values: string[] }) {
  if (!values.length) return <>Unknown</>;
  return <span className={styles.answerChips}>{values.map((value) => <span key={value}>{value}</span>)}</span>;
}

export default function GuidedProfileBuilder({ resumes, onCreated }: { resumes: Resume[]; onCreated: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [resumeId, setResumeId] = useState('');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [step, setStep] = useState(0);
  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const unknowns = useMemo(() => [!draft.name.trim() && 'career direction name', !draft.target_titles.length && 'target titles', !draft.industries.length && 'industries', !draft.include_keywords.length && 'evidence-backed strengths', !draft.work_types.length && 'work arrangement', !draft.countries.length && !draft.states_regions.length && 'location', !draft.target_base.trim() && 'target compensation'].filter(Boolean) as string[], [draft]);
  const answered = STEPS.length - unknowns.length;

  async function startFromResume() {
    if (!resumeId) { setMessage('Choose a resume first, or start with a blank guided profile.'); return; }
    setSuggesting(true);
    setMessage('Reading the resume and preparing suggestions for review.');
    try {
      const response = await fetch(`${API}/me/resumes/${resumeId}/suggest-strategy`, { method: 'POST' });
      if (response.status === 401) { window.location.replace('/sign-in'); return; }
      if (!response.ok) throw new Error('Kall could not prepare profile suggestions.');
      const { suggestion } = await response.json() as { suggestion: Suggestion | null };
      setDraft({ ...emptyDraft(), name: suggestion?.profile_name || '', target_titles: suggestion?.target_titles || [], industries: suggestion?.industries || [], include_keywords: suggestion?.keywords || [], work_types: suggestion?.work_types?.length ? suggestion.work_types : ['remote'], minimum_base: suggestion?.suggested_salary_min?.toString() || '', target_base: suggestion?.suggested_salary_max?.toString() || '' });
      setStep(0);
      setMessage(suggestion ? 'Suggestions are ready. Confirm or change every answer before saving.' : 'The resume did not provide enough signal, so unknown details remain blank.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Kall could not prepare profile suggestions.'); }
    finally { setSuggesting(false); }
  }

  function startBlank() { setDraft(emptyDraft()); setStep(0); setMessage('Answer what you know. Kall will keep missing details visible.'); }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.name.trim()) { setStep(0); setMessage('Give this direction a name before saving.'); return; }
    setSaving(true); setMessage('Saving only the answers shown in this review.');
    try {
      const response = await fetch(`${API}/me/professional-profiles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: draft.name.trim(), target_titles: draft.target_titles, industries: draft.industries, functional_areas: [], include_keywords: draft.include_keywords, exclude_keywords: [], countries: draft.countries, states_regions: draft.states_regions, cities: [], work_types: draft.work_types, employment_types: ['full_time'], pay_basis: 'salary', minimum_base: numberOrNull(draft.minimum_base), target_base: numberOrNull(draft.target_base), stretch_base: null, minimum_total_comp: null, target_total_comp: null, default_resume_id: resumeId ? Number(resumeId) : null }) });
      if (response.status === 401) { window.location.replace('/sign-in'); return; }
      if (!response.ok) throw new Error('Kall could not save this profile.');
      setMessage(`${draft.name.trim()} was created from your confirmed answers.`); setOpen(false); setDraft(emptyDraft()); setResumeId(''); await onCreated();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Kall could not save this profile.'); }
    finally { setSaving(false); }
  }

  const current = STEPS[step];
  const atReview = step === STEPS.length;
  const multiValueField = !atReview ? MULTI_VALUE_FIELDS[current.key] : undefined;
  return <section className={styles.guideCard}>
    <div className={styles.profileHeader}><div><p className="eyebrow">Guided profile</p><h2>Build a direction with Kall</h2><p>Start from a resume, then confirm one decision at a time. Suggestions never become profile facts until you save the final review.</p></div><button className="button" type="button" onClick={() => setOpen((value) => !value)}>{open ? 'Close guide' : 'Start guided profile'}</button></div>
    {open ? <form className={styles.guide} onSubmit={save}>
      <div className={styles.guideSource}><label>Resume source<select value={resumeId} onChange={(event) => setResumeId(event.target.value)}><option value="">No resume selected</option>{resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.name}</option>)}</select></label><button className="button secondary" type="button" disabled={suggesting} onClick={() => void startFromResume()}>{suggesting ? 'Preparing suggestions…' : 'Suggest from resume'}</button><button className="button ghost" type="button" onClick={startBlank}>Start blank</button></div>
      <div className={styles.guideStatus}><span>{atReview ? 'Final review' : `${current.module} · question ${step + 1} of ${STEPS.length}`}</span><span>{answered} answered · {unknowns.length} still open</span></div>
      {resumeId ? <div className={styles.knownFact}><strong>Kall found a resume source</strong><span>{resumes.find((resume) => String(resume.id) === resumeId)?.name}. Its suggestions remain drafts until your final save.</span></div> : null}
      {!atReview ? <fieldset className={styles.guideQuestion}><legend>{current.label}</legend><p>{current.help}</p>{current.key === 'location' ? <div className={styles.two}><ChipsInput label="Countries" placeholder="Add a country" value={draft.countries} onChange={(countries) => setDraft({ ...draft, countries })} /><ChipsInput label="States or regions" placeholder="Add a state or region" value={draft.states_regions} onChange={(states_regions) => setDraft({ ...draft, states_regions })} /></div> : current.key === 'compensation' ? <div className={styles.two}><label>Minimum annual base<input type="number" min="0" value={draft.minimum_base} onChange={(event) => setDraft({ ...draft, minimum_base: event.target.value })} /></label><label>Target annual base<input type="number" min="0" value={draft.target_base} onChange={(event) => setDraft({ ...draft, target_base: event.target.value })} /></label></div> : multiValueField ? <ChipsInput label={multiValueField.label} placeholder={multiValueField.placeholder} value={draft[multiValueField.key]} onChange={(values) => setDraft({ ...draft, [multiValueField.key]: values })} autoFocus /> : <label><span className="sr-only">{current.label}</span><input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>}</fieldset> : <section className={styles.guideReview}><h3>Review confirmed answers</h3><dl><div><dt>Direction</dt><dd>{draft.name || 'Unknown'}</dd></div><div><dt>Titles</dt><dd><AnswerChips values={draft.target_titles} /></dd></div><div><dt>Industries</dt><dd><AnswerChips values={draft.industries} /></dd></div><div><dt>Strengths</dt><dd><AnswerChips values={draft.include_keywords} /></dd></div><div><dt>Work arrangement</dt><dd><AnswerChips values={draft.work_types} /></dd></div><div><dt>Location</dt><dd><AnswerChips values={[...draft.countries, ...draft.states_regions]} /></dd></div><div><dt>Base range</dt><dd>{draft.minimum_base || draft.target_base ? `${draft.minimum_base || 'not set'} to ${draft.target_base || 'not set'}` : 'Unknown'}</dd></div></dl><div className={styles.unknowns}><strong>Kall’s suggested next move</strong>{unknowns.length ? <p>Save the usable direction now, then return for {unknowns.slice(0, 2).join(' and ')}. Kall will keep those gaps visible.</p> : <p>Run a job search with this direction, then refine it from the matches you receive.</p>}</div><div className={styles.unknowns}><strong>Still needs input</strong>{unknowns.length ? <ul>{unknowns.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Nothing. Every guided field has an answer.</p>}</div></section>}
      <div className={styles.actions}>{step > 0 && <button className="button secondary" type="button" onClick={() => setStep((value) => value - 1)}>Back</button>}{!atReview && <button className="button" type="button" onClick={() => setStep((value) => value + 1)}>Confirm and continue</button>}{atReview && <button className="button" disabled={saving}>{saving ? 'Saving…' : 'Create profile from confirmed answers'}</button>}</div>
    </form> : null}
    {message ? <p className={styles.message} role="status">{message}</p> : null}
  </section>;
}
