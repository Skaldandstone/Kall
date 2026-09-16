'use client';

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import ChipsInput from '../components/ChipsInput';
import ChipsToggle from '../components/ChipsToggle';
import FunctionalAreasInput from '../components/FunctionalAreasInput';
import { EMPLOYMENT_TYPE_OPTIONS, WORK_TYPE_OPTIONS, optionalProfileNumber } from '../lib/profileForm';
import GuidedProfileBuilder from './GuidedProfileBuilder';
import styles from './page.module.css';

const API = '/api/kall';

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data.detail === 'string') return data.detail;
  } catch {
    // Preserve the user-facing fallback when the response is not JSON.
  }
  return fallback;
}

// Marks an error whose message already came from the backend (a real,
// specific reason) so the catch block can tell it apart from a fetch that
// never got a response at all.
class UploadError extends Error {}

// The fetch itself failing (offline, DNS, connection reset, CORS) always
// surfaces as a TypeError in browsers -- never something more specific --
// so that's the only signal available to distinguish it from a genuine bug.
function uploadFailureMessage(error: unknown): string {
  if (error instanceof UploadError) return error.message;
  if (error instanceof TypeError) return "Kall couldn't reach the server. Check your connection and try again.";
  return 'Something went wrong uploading that resume. Please try again.';
}

type Profile = {
  id: number;
  name: string;
  target_titles: string[];
  industries: string[];
  functional_areas: string[];
  include_keywords: string[];
  exclude_keywords: string[];
  countries: string[];
  states_regions: string[];
  work_types: string[];
  employment_types: string[];
  minimum_base: number | null;
  target_base: number | null;
  stretch_base: number | null;
  minimum_total_comp: number | null;
  target_total_comp: number | null;
  target_bonus_percent: number | null;
  travel_max_percent: number | null;
  relocation_preference: string | null;
  equity_preference: string | null;
  default_resume_id: number | null;
  default_resume_name: string | null;
  is_active: boolean;
  match_count: number;
  best_match_score: number | null;
  completeness: { score: number };
};

type Resume = { id: number; name: string; version: number };
type UploadedResume = { id: number; name: string };

const EQUITY_LABELS: Record<string, string> = {
  not_important: 'Not important',
  nice_to_have: 'Nice to have',
  required: 'Required',
};

const csv = (value: FormDataEntryValue | null) =>
  String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
/** Fields rendered as chips rather than as a text box. */
const CHIP_FIELDS = new Set([
  'target_titles', 'industries', 'functional_areas',
  'include_keywords', 'exclude_keywords', 'countries', 'states_regions',
]);
const money = (value: number | null) =>
  value !== null ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value) : 'Not set';

export default function StrategyTab() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [uploadingProfileId, setUploadingProfileId] = useState<number | null>(null);
  const [suggestingId, setSuggestingId] = useState<number | null>(null);
  // Chip fields keep their values in React state behind a hidden input, so a
  // suggestion cannot be applied by assigning to the DOM node the way the
  // plain text boxes allowed. Suggested values are held here and fed back in
  // as new defaults; `suggestionRound` forces the remount that picks them up.
  const [suggestedChips, setSuggestedChips] = useState<Record<string, string[]>>({});
  const [suggestionRound, setSuggestionRound] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const formRefs = useRef<Record<number, HTMLFormElement | null>>({});

  async function load() {
    setLoading(true);
    try {
      const headers = { };
      const [profilesResponse, resumesResponse] = await Promise.all([
        fetch(`${API}/me/career-profiles`, { headers }),
        fetch(`${API}/me/resume-studio`, { headers }),
      ]);
      if (profilesResponse.status === 401 || resumesResponse.status === 401) {
        window.location.replace('/sign-in');
        return;
      }
      if (!profilesResponse.ok) throw new Error('Unable to load career profiles.');
      setProfiles((await profilesResponse.json()).profiles || []);
      if (resumesResponse.ok) setResumes((await resumesResponse.json()).resumes || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load career profiles.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function save(event: FormEvent<HTMLFormElement>, profile: Profile) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      name: String(form.get('name') || profile.name),
      target_titles: csv(form.get('target_titles')),
      industries: csv(form.get('industries')),
      functional_areas: csv(form.get('functional_areas')),
      include_keywords: csv(form.get('include_keywords')),
      exclude_keywords: csv(form.get('exclude_keywords')),
      countries: csv(form.get('countries')),
      states_regions: csv(form.get('states_regions')),
      work_types: csv(form.get('work_types')),
      employment_types: csv(form.get('employment_types')),
      minimum_base: optionalProfileNumber(form.get('minimum_base')),
      target_base: optionalProfileNumber(form.get('target_base')),
      stretch_base: optionalProfileNumber(form.get('stretch_base')),
      minimum_total_comp: optionalProfileNumber(form.get('minimum_total_comp')),
      target_total_comp: optionalProfileNumber(form.get('target_total_comp')),
      target_bonus_percent: optionalProfileNumber(form.get('target_bonus_percent')),
      travel_max_percent: optionalProfileNumber(form.get('travel_max_percent')),
      relocation_preference: String(form.get('relocation_preference') || '') || null,
      equity_preference: String(form.get('equity_preference') || '') || null,
      // Editing preferences must not reactivate a paused profile.
      is_active: profile.is_active,
    };
    const response = await fetch(`${API}/me/career-profiles/${profile.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.status === 401) {
      window.location.replace('/sign-in');
      return;
    }
    setMessage(response.ok ? `${body.name} updated.` : 'Unable to update profile.');
    if (response.ok) {
      setEditingId(null);
      await load();
    }
  }

  async function suggestFields(profile: Profile) {
    const form = formRefs.current[profile.id];
    if (!form) return;
    setSuggestingId(profile.id);
    setMessage('Asking Kall for suggestions…');
    try {
      const response = await fetch(`${API}/me/career-profiles/${profile.id}/suggest-fields`, { method: 'POST' });
      if (response.status === 401) {
        window.location.replace('/sign-in');
        return;
      }
      if (!response.ok) throw new Error('Unable to get suggestions right now.');
      const data = await response.json() as { enabled: boolean; suggestions: Record<string, unknown>; rationale: string | null };
      if (!data.enabled) {
        setMessage('AI suggestions need an OpenAI key configured -- fill these in manually for now.');
        return;
      }
      const suggested: string[] = [];
      const chips: Record<string, string[]> = {};
      for (const [field, value] of Object.entries(data.suggestions)) {
        const input = form.elements.namedItem(field) as HTMLInputElement | null;
        if (!input || input.value) continue; // never overwrite something already entered
        if (CHIP_FIELDS.has(field)) {
          chips[field] = Array.isArray(value)
            ? value.map(String)
            : String(value).split(',').map((item) => item.trim()).filter(Boolean);
        } else {
          input.value = Array.isArray(value) ? value.join(', ') : String(value);
        }
        suggested.push(field);
      }
      if (Object.keys(chips).length) {
        setSuggestedChips((current) => ({ ...current, ...chips }));
        setSuggestionRound((round) => round + 1);
      }
      setMessage(
        suggested.length
          ? `Filled in: ${suggested.join(', ')}.${data.rationale ? ` ${data.rationale}` : ''} Review before saving.`
          : data.rationale || 'This profile already has every suggestible field filled in.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to get suggestions right now.');
    } finally {
      setSuggestingId(null);
    }
  }

  async function setActive(profile: Profile, active: boolean) {
    // Omitted targeting fields stay untouched during pause/reactivate.
    const body = {
      name: profile.name,
      is_active: active,
    };
    const response = await fetch(`${API}/me/career-profiles/${profile.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.status === 401) {
      window.location.replace('/sign-in');
      return;
    }
    setMessage(
      response.ok
        ? `${profile.name} ${active ? 'reactivated' : 'paused'}.`
        : `Unable to ${active ? 'reactivate' : 'pause'} that profile.`,
    );
    if (response.ok) await load();
  }

  async function deleteProfile(profile: Profile) {
    const response = await fetch(`${API}/me/career-profiles/${profile.id}`, { method: 'DELETE' });
    if (response.status === 401) { window.location.replace('/sign-in'); return; }
    if (response.ok) {
      setDeletingId(null);
      setMessage(`${profile.name} deleted.`);
      await load();
      return;
    }
    const body = await response.json().catch(() => ({}));
    setMessage(typeof body.detail === 'string' ? body.detail : 'Unable to delete that profile.');
  }

  async function assignResume(profileId: number, resumeId: string, successMessage = 'Profile resume updated.') {
    const response = await fetch(`${API}/me/professional-profiles/${profileId}/default-resume`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume_id: resumeId ? Number(resumeId) : null }),
    });
    setMessage(response.ok ? successMessage : 'Unable to associate that resume.');
    if (response.ok) await load();
    return response.ok;
  }

  async function uploadResume(event: ChangeEvent<HTMLInputElement>, profile: Profile) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setUploadingProfileId(profile.id);
    setMessage(`Uploading ${file.name}…`);

    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(`${API}/me/resumes`, {
        method: 'POST',
        body: form,
      });
      if (response.status === 401) {
        window.location.replace('/sign-in');
        return;
      }
      if (!response.ok) throw new UploadError(await errorMessage(response, 'Unable to upload that resume.'));

      const uploaded = await response.json() as UploadedResume;
      const shouldMakeDefault = !profile.default_resume_id || window.confirm(
        `${uploaded.name} was uploaded. Make it the default resume for ${profile.name}?`,
      );

      if (shouldMakeDefault) {
        await assignResume(profile.id, String(uploaded.id), `${uploaded.name} uploaded and set as the default resume.`);
      } else {
        setMessage(`${uploaded.name} uploaded. The current default resume was kept.`);
        await load();
      }
    } catch (error) {
      setMessage(uploadFailureMessage(error));
    } finally {
      setUploadingProfileId(null);
    }
  }

  return (
    <>
      <div className="section-heading" style={{ marginBottom: 24 }}>
        <div>
          <span className="eyebrow">Career strategy</span>
          <p>Each profile gives Kall a distinct search, compensation, work-mode, and resume strategy.</p>
        </div>
        <a className="button" href="/onboarding">Create other profile</a>
      </div>

      <GuidedProfileBuilder resumes={resumes} onCreated={load} />

      {loading ? <section className={styles.state}>Loading career profiles…</section> : !profiles.length ? (
        <section className={styles.state}>
          <h2>No career profiles yet.</h2>
          <p>{message || 'Create one profile for each direction you want Kall to evaluate independently.'}</p>
          <a className="button" href="/onboarding">Create your first profile</a>
        </section>
      ) : (
        <section className={styles.list}>
          {profiles.map((profile) => (
            <div className={styles.profileRow} key={profile.id}>
              <article className={styles.card}>
                {editingId === profile.id ? (
                  <form
                    className={styles.form}
                    ref={(node) => { formRefs.current[profile.id] = node; }}
                    onSubmit={(event) => save(event, profile)}
                  >
                    <div className={styles.actions} style={{ marginTop: 0 }}>
                      <button
                        className="button secondary"
                        type="button"
                        disabled={suggestingId === profile.id}
                        onClick={() => void suggestFields(profile)}
                      >
                        {suggestingId === profile.id ? 'Asking Kall…' : 'Suggest empty fields'}
                      </button>
                    </div>
                    <label>Name<input name="name" defaultValue={profile.name} /></label>
                    {/* Chips, matching onboarding. A comma-separated text box
                        is worst exactly where it was used: on a phone, with
                        the keyboard covering the line being typed into. */}
                    <ChipsInput
                      key={`target_titles-${suggestionRound}`}
                      name="target_titles"
                      label="Target titles"
                      placeholder="Add a title and press Enter"
                      defaultValue={suggestedChips.target_titles ?? profile.target_titles}
                      helpText="Include close variants of the same title -- job boards phrase the same role differently."
                    />
                    <ChipsInput
                      key={`industries-${suggestionRound}`}
                      name="industries"
                      label="Industries"
                      placeholder="Add an industry"
                      defaultValue={suggestedChips.industries ?? profile.industries}
                    />
                    <FunctionalAreasInput
                      key={`functional_areas-${suggestionRound}`}
                      defaultValue={(suggestedChips.functional_areas ?? profile.functional_areas).join(', ')}
                    />
                    <ChipsInput
                      key={`include_keywords-${suggestionRound}`}
                      name="include_keywords"
                      label="Include keywords"
                      placeholder="Add a skill or specialization"
                      defaultValue={suggestedChips.include_keywords ?? profile.include_keywords}
                    />
                    <ChipsInput
                      key={`exclude_keywords-${suggestionRound}`}
                      name="exclude_keywords"
                      label="Exclude keywords"
                      placeholder="Add a phrase to exclude"
                      defaultValue={suggestedChips.exclude_keywords ?? profile.exclude_keywords}
                      helpText="Jobs mentioning these phrases are excluded."
                    />
                    <div className={styles.two}>
                      <ChipsInput key={`countries-${suggestionRound}`} name="countries" label="Countries" placeholder="Add a country" defaultValue={suggestedChips.countries ?? profile.countries} />
                      <ChipsInput key={`states_regions-${suggestionRound}`} name="states_regions" label="States or regions" placeholder="Add a state or region" defaultValue={suggestedChips.states_regions ?? profile.states_regions} />
                    </div>
                    <div className={styles.two}>
                      <ChipsToggle name="work_types" label="Work types" options={WORK_TYPE_OPTIONS} defaultValue={profile.work_types} />
                      <ChipsToggle name="employment_types" label="Employment types" options={EMPLOYMENT_TYPE_OPTIONS} defaultValue={profile.employment_types} />
                    </div>
                    <div className={styles.two}>
                      <label>Minimum base<input type="number" name="minimum_base" defaultValue={profile.minimum_base ?? ''} /></label>
                      <label>Target base<input type="number" name="target_base" defaultValue={profile.target_base ?? ''} /></label>
                    </div>
                    <div className={styles.two}>
                      <label>Stretch base<input type="number" name="stretch_base" defaultValue={profile.stretch_base ?? ''} /></label>
                      <label>Minimum total compensation<input type="number" name="minimum_total_comp" defaultValue={profile.minimum_total_comp ?? ''} /></label>
                    </div>
                    <div className={styles.two}>
                      <label>Total compensation<input type="number" name="target_total_comp" defaultValue={profile.target_total_comp ?? ''} /></label>
                      <label>Target bonus %<input type="number" min="0" step="0.1" name="target_bonus_percent" defaultValue={profile.target_bonus_percent ?? ''} /></label>
                    </div>
                    <div className={styles.two}>
                      <label>Maximum travel %<input type="number" min="0" max="100" name="travel_max_percent" defaultValue={profile.travel_max_percent ?? ''} /></label>
                      <label>Relocation<select name="relocation_preference" defaultValue={profile.relocation_preference ?? ''}><option value="">Not specified</option><option value="none">No relocation</option><option value="consider">Will consider</option><option value="preferred">Relocation preferred</option></select></label>
                    </div>
                    <label>Equity<select name="equity_preference" defaultValue={profile.equity_preference ?? ''}><option value="">Not specified</option><option value="not_important">Not important</option><option value="nice_to_have">Nice to have</option><option value="required">Required</option></select></label>
                    <div className={styles.actions}>
                      <button className="button">Save profile</button>
                      <button className="button secondary" type="button" onClick={() => { setSuggestedChips({}); setEditingId(null); }}>Cancel</button>
                    </div>
                  </form>
                ) : (
                  <div className={styles.profileView}>
                    <div className={styles.profileHeader}>
                      <div><p className="eyebrow">{profile.is_active ? 'Active profile' : 'Paused profile'}</p><h2>{profile.name}</h2></div>
                      <div className={styles.actions} style={{ marginTop: 0 }}>
                        <button className="button secondary" onClick={() => { setSuggestedChips({}); setEditingId(profile.id); }}>Edit profile</button>
                        {profile.is_active ? (
                          <button className="button ghost" onClick={() => setActive(profile, false)}>Pause</button>
                        ) : (
                          <button className="button ghost" onClick={() => setActive(profile, true)}>Reactivate</button>
                        )}
                        <button className="button danger" onClick={() => setDeletingId(profile.id)}>Delete</button>
                      </div>
                    </div>
                    {deletingId === profile.id && <div className="card" role="alertdialog" aria-labelledby={`delete-profile-${profile.id}`}><h3 id={`delete-profile-${profile.id}`}>Delete {profile.name}?</h3><p>This permanently removes this career direction, its matches, opportunities, and scheduled searches. Existing applications or tailoring proposals must be removed first.</p><div className={styles.actions}><button className="button danger" type="button" onClick={() => void deleteProfile(profile)}>Yes, delete profile</button><button className="button ghost" type="button" autoFocus onClick={() => setDeletingId(null)}>Keep profile</button></div></div>}
                    <div className={styles.tags}>{profile.target_titles.length ? profile.target_titles.map((title) => <span className={styles.tag} key={title}>{title}</span>) : <span className={styles.tag}>No target titles</span>}</div>
                    <dl className={styles.details}>
                      <div><dt>Industries</dt><dd>{profile.industries.join(', ') || 'Not set'}</dd></div>
                      <div><dt>Functional areas</dt><dd>{profile.functional_areas.join(', ') || 'Not set'}</dd></div>
                      <div><dt>Locations</dt><dd>{[...profile.countries, ...profile.states_regions].join(', ') || 'Not set'}</dd></div>
                      <div><dt>Work types</dt><dd>{profile.work_types.join(', ') || 'Not set'}</dd></div>
                      <div><dt>Employment types</dt><dd>{profile.employment_types.join(', ') || 'Not set'}</dd></div>
                      <div><dt>Target base</dt><dd>{money(profile.target_base)}</dd></div>
                      <div><dt>Total compensation</dt><dd>{money(profile.target_total_comp)}</dd></div>
                      <div><dt>Target bonus</dt><dd>{profile.target_bonus_percent != null ? `${profile.target_bonus_percent}%` : 'Not set'}</dd></div>
                      <div><dt>Equity</dt><dd>{EQUITY_LABELS[profile.equity_preference ?? ''] ?? 'Not specified'}</dd></div>
                      <div><dt>Keywords</dt><dd>{profile.include_keywords.join(', ') || 'Not set'}</dd></div>
                      <div><dt>Excluded keywords</dt><dd>{profile.exclude_keywords.join(', ') || 'None'}</dd></div>
                      <div><dt>Maximum travel</dt><dd>{profile.travel_max_percent !== null ? `${profile.travel_max_percent}%` : 'Not set'}</dd></div>
                    </dl>
                    <div className={styles.metrics}>
                      <article><strong>{profile.completeness.score}%</strong><span>Profile completeness</span></article>
                      <article><strong>{profile.match_count}</strong><span>Stored matches</span></article>
                      <article><strong>{profile.best_match_score ?? '—'}</strong><span>Best match score</span></article>
                    </div>
                  </div>
                )}
              </article>
              <aside className={styles.sideCard}>
                <h3>Profile resume</h3>
                <p>Choose the default resume Kall should use for this profile.</p>
                <select aria-label={`Default resume for ${profile.name}`} value={profile.default_resume_id ?? ''} onChange={(event) => void assignResume(profile.id, event.target.value)}>
                  <option value="">No default resume</option>
                  {resumes.map((resume) => <option value={resume.id} key={resume.id}>{resume.name} · v{resume.version}</option>)}
                </select>
                <label className={`button secondary ${styles.uploadButton}`}>
                  {uploadingProfileId === profile.id ? 'Uploading…' : 'Upload resume'}
                  <input
                    className={styles.fileInput}
                    type="file"
                    accept=".pdf,.docx"
                    disabled={uploadingProfileId !== null}
                    onChange={(event) => void uploadResume(event, profile)}
                  />
                </label>
                <a className="button secondary" href={`/search?profile=${profile.id}`}>View opportunities</a>
              </aside>
            </div>
          ))}
        </section>
      )}
      {message && profiles.length > 0 && <p className={styles.message}>{message}</p>}
    </>
  );
}
