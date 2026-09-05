'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { countries, countryName, regionsForCountry } from '../../lib/location-data';
import styles from './page.module.css';
import { fetchKall } from '../lib/api';
import FunctionalAreasInput from '../components/FunctionalAreasInput';
import { optionalProfileNumber } from '../lib/profileForm';

const API = '/api/kall';
const csv = (value: FormDataEntryValue | null) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const selectedOptions = (element: HTMLSelectElement): string[] =>
  Array.from(element.selectedOptions, (option) => option.value);

type StrategySuggestion = {
  summary: string;
  target_titles: string[];
  industries: string[];
  keywords: string[];
  work_types: string[];
};

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data.detail === 'string') return data.detail;
    if (Array.isArray(data.detail)) {
      return data.detail.map((item: unknown) => JSON.stringify(item)).join(', ');
    }
  } catch {
    // Preserve the user-facing fallback when the response is not JSON.
  }
  return fallback;
}

export default function Onboarding() {
  const [step, setStep] = useState(2);
  const [token, setToken] = useState('');
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [profileCreated, setProfileCreated] = useState(false);
  const [resumeUploaded, setResumeUploaded] = useState(false);
  const [suggestion, setSuggestion] = useState<StrategySuggestion | null>(null);
  const [selectedCountryCodes, setSelectedCountryCodes] = useState<string[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);

  const regionGroups = useMemo(
    () =>
      selectedCountryCodes.map((code) => ({
        code,
        name: countryName(code) || code,
        regions: regionsForCountry(code),
      })),
    [selectedCountryCodes],
  );

  const availableRegionNames = useMemo(
    () => new Set(regionGroups.flatMap((group) => group.regions.map((region) => region.name))),
    [regionGroups],
  );

  useEffect(() => {
    // Reaching this page at all means Clerk's middleware already let the
    // request through, so there is nothing further to check here.
    setReady(true);

    // Best-effort default so most users don't have to scroll a long country
    // list at all; still fully editable/removable in the multi-select below.
    try {
      const region = new Intl.Locale(navigator.language).maximize().region;
      if (region && countries.some((country) => country.code === region)) {
        setSelectedCountryCodes([region]);
      }
    } catch {
      // Intl.Locale isn't available everywhere -- leave the field blank.
    }
  }, []);

  function changeCountries(element: HTMLSelectElement) {
    const nextCountryCodes = selectedOptions(element);
    const nextRegionNames = new Set(
      nextCountryCodes.flatMap((code) => regionsForCountry(code).map((region) => region.name)),
    );
    setSelectedCountryCodes(nextCountryCodes);
    setSelectedRegions((current) => current.filter((region) => nextRegionNames.has(region)));
  }

  async function createProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setSubmitting(true);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetchKall(`/me/professional-profiles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: form.get('name'),
          target_titles: csv(form.get('target_titles')),
          industries: csv(form.get('industries')),
          functional_areas: csv(form.get('functional_areas')),
          include_keywords: csv(form.get('include_keywords')),
          exclude_keywords: csv(form.get('exclude_keywords')),
          countries: selectedCountryCodes.map((code) => countryName(code) || code),
          states_regions: selectedRegions,
          work_types: csv(form.get('work_types')),
          minimum_base: optionalProfileNumber(form.get('minimum_base')),
          target_base: optionalProfileNumber(form.get('target_base')),
          stretch_base: null,
          minimum_total_comp: null,
          target_total_comp: null,
          default_resume_id: null,
        }),
      });

      if (response.status === 401) {
        window.location.replace('/sign-in');
        return;
      }
      if (!response.ok) {
        setMessage(await errorMessage(response, 'Could not create your career strategy.'));
        return;
      }

      setProfileCreated(true);
      setStep(4);
      markComplete(resumeUploaded, true);
    } catch {
      setMessage('Kall could not save your strategy. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function uploadResume(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setSubmitting(true);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetchKall(`/me/resumes`, {
        method: 'POST',
        body: form,
      });

      if (response.status === 401) {
        window.location.replace('/sign-in');
        return;
      }
      if (!response.ok) {
        setMessage(await errorMessage(response, 'Resume upload failed.'));
        return;
      }

      const resume = await response.json();
      setResumeUploaded(true);

      try {
        const suggestResponse = await fetchKall(`/me/resumes/${resume.id}/suggest-strategy`, {
          method: 'POST'
        });
        if (suggestResponse.ok) {
          const body = await suggestResponse.json();
          setSuggestion(body.suggestion ?? null);
        }
      } catch {
        // A missing suggestion just means the strategy form starts blank --
        // not worth blocking or alarming the user over.
      }

      setStep(3);
    } catch {
      setMessage('Kall could not upload your resume. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function skipResume() {
    setStep(3);
  }

  function skipStrategy() {
    setStep(4);
    markComplete(resumeUploaded, false);
  }

  async function markComplete(withResume: boolean, withProfile: boolean) {
    const completedSteps = ['account'];
    if (withResume) completedSteps.push('resume');
    if (withProfile) completedSteps.push('strategy');
    try {
      await fetchKall(`/profile/onboarding`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_step: 'complete',
          completed_steps: completedSteps,
          dismissed_steps: [],
          is_complete: true,
        }),
      });
    } catch {
      // The wizard itself already finished -- a failed progress write just
      // means a returning user might see onboarding again, not that
      // anything they entered was lost.
    }
  }

  if (!ready) {
    return (
      <main className={styles.shell}>
        <section className={styles.panel}>
          <p className={styles.intro}>Preparing your Kall workspace…</p>
        </section>
      </main>
    );
  }

  return (
    <>
      <main className={styles.shell}>
      <div className={styles.layout}>
        <aside className={styles.aside}>
          <div className={styles.brand}>Kall</div>
          <div className={styles.steps}>
            {[
              ['Account', 'Your private career workspace'],
              ['Resume', 'What you have built'],
              ['Strategy', 'Where you want to go'],
            ].map((item, index) => {
              const number = index + 1;
              return (
                <div
                  key={item[0]}
                  className={`${styles.step} ${step === number ? styles.active : ''} ${step > number ? styles.done : ''}`}
                >
                  <strong>{step > number ? '✓' : number}</strong>
                  <div>
                    <b>{item[0]}</b>
                    <small>{item[1]}</small>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        <section className={styles.panel}>
          {step === 2 && (
            <>
              <p className="eyebrow">Resume Studio</p>
              <h1>Add the resume Kall should understand first.</h1>
              <p className={styles.intro}>
                Kall extracts the document text and uses it to suggest a starting career strategy next --
                you will review and can change anything before it is saved.
              </p>
              <form className={styles.form} onSubmit={uploadResume}>
                <label>
                  <span>Resume file</span>
                  <input className={styles.input} type="file" name="file" accept=".pdf,.docx" required />
                  <small>PDF or Word document.</small>
                </label>
                <div className={styles.note}>
                  Use a factual, current resume. Kall will not invent qualifications or silently change source facts.
                </div>
                <div className={styles.actions}>
                  <button type="button" className={`${styles.button} ${styles.secondary}`} onClick={skipResume}>
                    Skip for now
                  </button>
                  <button type="submit" className={styles.button} disabled={submitting}>
                    {submitting ? 'Uploading…' : 'Upload resume'}
                  </button>
                </div>
              </form>
            </>
          )}

          {step === 3 && (
            <>
              <p className="eyebrow">Career strategy</p>
              <h1>Where do you want your career to go?</h1>
              <p className={styles.intro}>
                {suggestion
                  ? 'Suggested from your resume -- review and edit anything before saving.'
                  : 'Start with one focused direction; you can add more strategies later.'}
              </p>
              <form className={styles.form} onSubmit={createProfile}>
                <label>Strategy name<input className={styles.input} name="name" placeholder="Quality leadership" required /></label>
                <label>
                  Target roles
                  <textarea
                    className={styles.input}
                    name="target_titles"
                    rows={4}
                    placeholder="Quality director, Head of quality"
                    defaultValue={suggestion?.target_titles.join(', ') || ''}
                    required
                  />
                  <small>Separate roles with commas.</small>
                </label>
                <label>
                  Industries
                  <input
                    className={styles.input}
                    name="industries"
                    placeholder="Medical devices, manufacturing"
                    defaultValue={suggestion?.industries.join(', ') || ''}
                  />
                  <small>Separate industries with commas.</small>
                </label>
                <FunctionalAreasInput className={styles.input} />
                <label>
                  Important keywords
                  <input
                    className={styles.input}
                    name="include_keywords"
                    placeholder="Audit readiness, CAPA"
                    defaultValue={suggestion?.keywords.join(', ') || ''}
                  />
                  <small>Separate phrases with commas.</small>
                </label>
                <label>Exclude keywords<input className={styles.input} name="exclude_keywords" placeholder="Unpaid internship, door-to-door" /><small>Separate phrases with commas. Jobs mentioning these phrases are excluded.</small></label>

                <label>
                  <span>Countries</span>
                  <select
                    className={styles.input}
                    name="countries"
                    multiple
                    size={8}
                    value={selectedCountryCodes}
                    onChange={(event) => changeCountries(event.currentTarget)}
                    aria-describedby="countries-help"
                  >
                    {countries.map((country) => (
                      <option key={country.code} value={country.code}>{country.name}</option>
                    ))}
                  </select>
                  <small id="countries-help">Hold Ctrl (Windows) or Command (Mac) to select multiple countries.</small>
                </label>

                <label>
                  <span>States or regions</span>
                  <select
                    className={styles.input}
                    name="states_regions"
                    multiple
                    size={10}
                    value={selectedRegions}
                    disabled={selectedCountryCodes.length === 0 || availableRegionNames.size === 0}
                    onChange={(event) => setSelectedRegions(selectedOptions(event.currentTarget))}
                    aria-describedby="regions-help"
                  >
                    {regionGroups.map((group) => (
                      <optgroup key={group.code} label={group.name}>
                        {group.regions.map((region) => (
                          <option key={`${group.code}-${region.code}`} value={region.name}>{region.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <small id="regions-help">
                    {selectedCountryCodes.length === 0
                      ? 'Select one or more countries first.'
                      : 'Hold Ctrl (Windows) or Command (Mac) to select multiple states or regions.'}
                  </small>
                </label>

                <label>
                  Work arrangements
                  <input
                    className={styles.input}
                    name="work_types"
                    defaultValue={suggestion?.work_types.join(', ') || 'remote, hybrid'}
                    placeholder="Remote, hybrid"
                  />
                  <small>Separate arrangements with commas.</small>
                </label>
                <div className={styles.two}>
                  <label>Minimum base salary<input className={styles.input} name="minimum_base" type="number" inputMode="numeric" placeholder="90000" /></label>
                  <label>Target base salary<input className={styles.input} name="target_base" type="number" inputMode="numeric" placeholder="120000" /></label>
                </div>
                <div className={styles.actions}>
                  <button type="button" className={`${styles.button} ${styles.secondary}`} onClick={skipStrategy}>
                    Skip for now
                  </button>
                  <button type="submit" className={styles.button} disabled={submitting}>
                    {submitting ? 'Saving…' : 'Save strategy'}
                  </button>
                </div>
              </form>
            </>
          )}

          {step === 4 && (
            <div className={styles.complete}>
              <p className="eyebrow">Foundation ready</p>
              <h1>Your first career workspace is prepared.</h1>
              <p className={styles.intro}>
                The Morning Brief will use only the information currently stored in Kall.
              </p>
              <div className={styles.checklist}>
                <div className={styles.check}>
                  <span>✓</span>
                  <div><b>Account created</b><p>Your private workspace is available.</p></div>
                </div>
                <div className={styles.check}>
                  <span>{resumeUploaded ? '✓' : '○'}</span>
                  <div><b>Starting resume</b><p>{resumeUploaded ? 'Your resume is in Resume Studio.' : 'Upload one later from Resume Studio.'}</p></div>
                </div>
                <div className={styles.check}>
                  <span>{profileCreated ? '✓' : '○'}</span>
                  <div><b>Career strategy</b><p>{profileCreated ? 'Your first direction is saved.' : 'Add a strategy from Career Profiles.'}</p></div>
                </div>
              </div>
              <div className={styles.actions}>
                <a className={`${styles.button} ${styles.secondary}`} href="/profiles">Review strategy</a>
                <a className={`${styles.button} ${styles.secondary}`} href="/morning-brief">Open Morning Brief</a>
                <a className={styles.button} href="/dashboard">Go to dashboard</a>
              </div>
            </div>
          )}

          <p className={styles.message} role="status" aria-live="polite">{message}</p>
        </section>
      </div>
      </main>
    </>
  );
}
