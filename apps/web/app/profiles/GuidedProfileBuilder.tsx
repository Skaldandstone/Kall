'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import ChipsInput from '../components/ChipsInput';
import styles from './GuidedProfileBuilder.module.css';

const API = '/api/kall';
type Resume = { id: number; name: string; version: number };
type Suggestion = { profile_name?: string; target_titles?: string[]; functional_areas?: string[]; industries?: string[]; keywords?: string[]; work_types?: string[]; suggested_salary_min?: number | null; suggested_salary_max?: number | null };
type MultiValueKey = 'target_titles' | 'functional_areas' | 'industries' | 'include_keywords' | 'work_types' | 'countries' | 'states_regions';
type Draft = { name: string; target_titles: string[]; functional_areas: string[]; industries: string[]; include_keywords: string[]; work_types: string[]; countries: string[]; states_regions: string[]; minimum_base: string; target_base: string };
type Suggested = Partial<Record<MultiValueKey, string[]>>;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const emptyDraft = (): Draft => ({ name: '', target_titles: [], functional_areas: [], industries: [], include_keywords: [], work_types: ['remote'], countries: ['United States'], states_regions: [], minimum_base: '', target_base: '' });
const STEPS = [
  { module: 'Direction', key: 'name', label: 'What should we call this career direction?', help: 'Use a short label such as Quality Leadership or Fractional Engineering.' },
  { module: 'Direction', key: 'target_titles', label: 'Which titles should Kall look for?', help: 'Tap a suggestion to approve it, or add another. Each approved title brings up the other spellings job boards use for it.' },
  { module: 'Direction', key: 'functional_areas', label: 'Which functions describe the work?', help: 'Kall widens the search to related titles in these areas, so a role phrased differently still shows up. Optional.' },
  { module: 'Direction', key: 'industries', label: 'Which industries fit this direction?', help: 'Add each short, common industry name as its own choice.' },
  { module: 'Evidence', key: 'include_keywords', label: 'Which strengths should matching roles need?', help: 'Only keep skills and specialties your record can support.' },
  { module: 'Work fit', key: 'work_types', label: 'How do you want to work?', help: 'Examples: remote, hybrid, onsite.' },
  { module: 'Work fit', key: 'location', label: 'Where are you willing to work?', help: 'Add countries and states or regions. Leave unknown details unfinished.' },
  { module: 'Compensation', key: 'compensation', label: 'What compensation range should Kall use?', help: 'Resume suggestions are unverified estimates. Replace them with your own decision.' },
] as const;
const numberOrNull = (value: string) => value.trim() ? Number(value) : null;
const MULTI_VALUE_FIELDS: Partial<Record<(typeof STEPS)[number]['key'], { key: MultiValueKey; label: string; placeholder: string }>> = {
  target_titles: { key: 'target_titles', label: 'Confirmed titles', placeholder: 'Add another title' },
  functional_areas: { key: 'functional_areas', label: 'Confirmed functions', placeholder: 'Add a function' },
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
  const [suggested, setSuggested] = useState<Suggested>({});
  const [functionalAreas, setFunctionalAreas] = useState<Array<{ name: string; related_roles: string[] }>>([]);
  const relatedAskedFor = useRef('');

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    fetch(`${API}/me/career-profiles/functional-areas`, { signal: abort.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (data) setFunctionalAreas(data.areas); })
      .catch(() => undefined);
    return () => abort.abort();
  }, [open]);

  function mergeSuggested(incoming: Suggested) {
    setSuggested((current) => {
      const next: Suggested = { ...current };
      for (const [key, values] of Object.entries(incoming) as Array<[MultiValueKey, string[] | undefined]>) {
        const existing = next[key] ?? [];
        next[key] = [...existing, ...(values ?? []).filter((value) => value && !existing.some((item) => same(item, value)))];
      }
      return next;
    });
  }

  // Every approved title asks for the next spellings boards use for it.
  const currentKey = STEPS[step]?.key;
  useEffect(() => {
    if (!open || currentKey !== 'target_titles' || draft.target_titles.length === 0) return;
    const signature = draft.target_titles.map((title) => title.toLowerCase()).sort().join('|');
    if (signature === relatedAskedFor.current) return;
    const handle = setTimeout(() => {
      relatedAskedFor.current = signature;
      fetch(`${API}/me/career-profiles/related-titles`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titles: draft.target_titles, exclude: suggested.target_titles ?? [] }),
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => { if (data?.titles?.length) mergeSuggested({ target_titles: data.titles }); })
        .catch(() => undefined);
    }, 350);
    return () => clearTimeout(handle);
  }, [open, currentKey, draft.target_titles, suggested.target_titles]);

  const impliedAreas = useMemo(() => {
    const titles = draft.target_titles.map((title) => title.toLowerCase());
    return functionalAreas
      .filter((area) => [area.name, ...area.related_roles].some((phrase) => titles.some((title) => title.includes(phrase.toLowerCase()))))
      .map((area) => area.name);
  }, [draft.target_titles, functionalAreas]);

  function suggestionsFor(key: MultiValueKey): string[] {
    const pool = key === 'functional_areas' ? [...(suggested.functional_areas ?? []), ...impliedAreas] : suggested[key] ?? [];
    return pool.filter((value, index, all) => all.findIndex((item) => same(item, value)) === index && !draft[key].some((item) => same(item, value)));
  }
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
      // Facts with a single answer (name, pay estimate) are pre-filled for
      // editing; list answers are offered as suggestions to approve one at a
      // time, never silently written into the profile.
      setDraft({ ...emptyDraft(), name: suggestion?.profile_name || '', work_types: suggestion?.work_types?.length ? suggestion.work_types : ['remote'], minimum_base: suggestion?.suggested_salary_min?.toString() || '', target_base: suggestion?.suggested_salary_max?.toString() || '' });
      setSuggested({});
      relatedAskedFor.current = '';
      mergeSuggested({ target_titles: suggestion?.target_titles || [], functional_areas: suggestion?.functional_areas || [], industries: suggestion?.industries || [], include_keywords: suggestion?.keywords || [] });
      setStep(0);
      setMessage(suggestion ? 'Suggestions are ready. Approve the ones that fit as you move through the questions.' : 'The resume did not provide enough signal, so unknown details remain blank.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Kall could not prepare profile suggestions.'); }
    finally { setSuggesting(false); }
  }

  function startBlank() { setDraft(emptyDraft()); setSuggested({}); relatedAskedFor.current = ''; setStep(0); setMessage('Answer what you know. Kall will keep missing details visible.'); }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.name.trim()) { setStep(0); setMessage('Give this direction a name before saving.'); return; }
    setSaving(true); setMessage('Saving only the answers shown in this review.');
    try {
      const response = await fetch(`${API}/me/professional-profiles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: draft.name.trim(), target_titles: draft.target_titles, industries: draft.industries, functional_areas: draft.functional_areas, include_keywords: draft.include_keywords, exclude_keywords: [], countries: draft.countries, states_regions: draft.states_regions, cities: [], work_types: draft.work_types, employment_types: ['full_time'], pay_basis: 'salary', minimum_base: numberOrNull(draft.minimum_base), target_base: numberOrNull(draft.target_base), stretch_base: null, minimum_total_comp: null, target_total_comp: null, default_resume_id: resumeId ? Number(resumeId) : null }) });
      if (response.status === 401) { window.location.replace('/sign-in'); return; }
      if (!response.ok) throw new Error('Kall could not save this profile.');
      setMessage(`${draft.name.trim()} was created from your confirmed answers.`); setOpen(false); setDraft(emptyDraft()); setSuggested({}); setResumeId(''); await onCreated();
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
      {!atReview ? <fieldset className={styles.guideQuestion}><legend>{current.label}</legend><p>{current.help}</p>{current.key === 'location' ? <div className={styles.two}><ChipsInput label="Countries" placeholder="Add a country" value={draft.countries} onChange={(countries) => setDraft({ ...draft, countries })} /><ChipsInput label="States or regions" placeholder="Add a state or region" value={draft.states_regions} onChange={(states_regions) => setDraft({ ...draft, states_regions })} /></div> : current.key === 'compensation' ? <div className={styles.two}><label>Minimum annual base<input type="number" min="0" value={draft.minimum_base} onChange={(event) => setDraft({ ...draft, minimum_base: event.target.value })} /></label><label>Target annual base<input type="number" min="0" value={draft.target_base} onChange={(event) => setDraft({ ...draft, target_base: event.target.value })} /></label></div> : multiValueField ? <>
            {suggestionsFor(multiValueField.key).length ? <div className={styles.suggestions} role="group" aria-label={`Suggested ${multiValueField.label.toLowerCase()}`}>
              <span>Suggested. Click to approve.</span>
              <div className={styles.answerChips}>{suggestionsFor(multiValueField.key).map((value) => <button type="button" key={value} className={styles.suggestion} onClick={() => setDraft({ ...draft, [multiValueField.key]: [...draft[multiValueField.key], value] })}>+ {value}</button>)}</div>
            </div> : null}
            <ChipsInput label={multiValueField.label} placeholder={multiValueField.placeholder} value={draft[multiValueField.key]} onChange={(values) => setDraft({ ...draft, [multiValueField.key]: values })} suggestions={multiValueField.key === 'functional_areas' ? functionalAreas.map((area) => area.name) : undefined} autoFocus />
          </> :<label><span className="sr-only">{current.label}</span><input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>}</fieldset> : <section className={styles.guideReview}><h3>Review confirmed answers</h3><dl><div><dt>Direction</dt><dd>{draft.name || 'Unknown'}</dd></div><div><dt>Titles</dt><dd><AnswerChips values={draft.target_titles} /></dd></div><div><dt>Functions</dt><dd><AnswerChips values={draft.functional_areas} /></dd></div><div><dt>Industries</dt><dd><AnswerChips values={draft.industries} /></dd></div><div><dt>Strengths</dt><dd><AnswerChips values={draft.include_keywords} /></dd></div><div><dt>Work arrangement</dt><dd><AnswerChips values={draft.work_types} /></dd></div><div><dt>Location</dt><dd><AnswerChips values={[...draft.countries, ...draft.states_regions]} /></dd></div><div><dt>Base range</dt><dd>{draft.minimum_base || draft.target_base ? `${draft.minimum_base || 'not set'} to ${draft.target_base || 'not set'}` : 'Unknown'}</dd></div></dl><div className={styles.unknowns}><strong>Kall’s suggested next move</strong>{unknowns.length ? <p>Save the usable direction now, then return for {unknowns.slice(0, 2).join(' and ')}. Kall will keep those gaps visible.</p> : <p>Run a job search with this direction, then refine it from the matches you receive.</p>}</div><div className={styles.unknowns}><strong>Still needs input</strong>{unknowns.length ? <ul>{unknowns.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Nothing. Every guided field has an answer.</p>}</div></section>}
      <div className={styles.actions}>{step > 0 && <button className="button secondary" type="button" onClick={() => setStep((value) => value - 1)}>Back</button>}{!atReview && <button className="button" type="button" onClick={() => setStep((value) => value + 1)}>Confirm and continue</button>}{atReview && <button className="button" disabled={saving}>{saving ? 'Saving…' : 'Create profile from confirmed answers'}</button>}</div>
    </form> : null}
    {message ? <p className={styles.message} role="status">{message}</p> : null}
  </section>;
}
