'use client';

import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import styles from './page.module.css';

const API = '/api/kall';

type Profile = {
  id: number;
  name: string;
  target_titles: string[];
  industries: string[];
  include_keywords: string[];
  countries: string[];
  states_regions: string[];
  work_types: string[];
  minimum_base: number | null;
  target_base: number | null;
  stretch_base: number | null;
  target_total_comp: number | null;
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
const money = (value: number | null) =>
  value ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value) : 'Not set';

export default function StrategyTab() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [uploadingProfileId, setUploadingProfileId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

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
      functional_areas: [],
      include_keywords: csv(form.get('include_keywords')),
      exclude_keywords: [],
      countries: csv(form.get('countries')),
      states_regions: csv(form.get('states_regions')),
      work_types: csv(form.get('work_types')),
      minimum_base: Number(form.get('minimum_base')) || null,
      target_base: Number(form.get('target_base')) || null,
      stretch_base: Number(form.get('stretch_base')) || null,
      target_total_comp: Number(form.get('target_total_comp')) || null,
      travel_max_percent: Number(form.get('travel_max_percent')) || null,
      relocation_preference: String(form.get('relocation_preference') || '') || null,
      equity_preference: String(form.get('equity_preference') || '') || null,
      // The endpoint replaces every field, not just the ones on this form --
      // hardcoding true here silently reactivated a paused profile on its
      // next edit, which is exactly backwards from what editing should do.
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

  async function setActive(profile: Profile, active: boolean) {
    // PUT replaces the whole row, so pausing has to resend everything this
    // profile already has -- not just the one field that changed.
    const body = {
      name: profile.name,
      target_titles: profile.target_titles,
      industries: profile.industries,
      functional_areas: [],
      include_keywords: profile.include_keywords,
      exclude_keywords: [],
      countries: profile.countries,
      states_regions: profile.states_regions,
      work_types: profile.work_types,
      minimum_base: profile.minimum_base,
      target_base: profile.target_base,
      stretch_base: profile.stretch_base,
      target_total_comp: profile.target_total_comp,
      travel_max_percent: profile.travel_max_percent,
      relocation_preference: profile.relocation_preference,
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
      if (!response.ok) throw new Error('Unable to upload that resume.');

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
      setMessage(error instanceof Error ? error.message : 'Unable to upload that resume.');
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
                  <form className={styles.form} onSubmit={(event) => save(event, profile)}>
                    <label>Name<input name="name" defaultValue={profile.name} /></label>
                    <label>Target titles<input name="target_titles" defaultValue={profile.target_titles.join(', ')} /></label>
                    <label>Industries<input name="industries" defaultValue={profile.industries.join(', ')} /></label>
                    <label>Include keywords<input name="include_keywords" defaultValue={profile.include_keywords.join(', ')} /></label>
                    <div className={styles.two}>
                      <label>Countries<input name="countries" defaultValue={profile.countries.join(', ')} /></label>
                      <label>States or regions<input name="states_regions" defaultValue={profile.states_regions.join(', ')} /></label>
                    </div>
                    <label>Work types<input name="work_types" defaultValue={profile.work_types.join(', ')} /></label>
                    <div className={styles.two}>
                      <label>Minimum base<input type="number" name="minimum_base" defaultValue={profile.minimum_base ?? ''} /></label>
                      <label>Target base<input type="number" name="target_base" defaultValue={profile.target_base ?? ''} /></label>
                    </div>
                    <div className={styles.two}>
                      <label>Stretch base<input type="number" name="stretch_base" defaultValue={profile.stretch_base ?? ''} /></label>
                      <label>Total compensation<input type="number" name="target_total_comp" defaultValue={profile.target_total_comp ?? ''} /></label>
                    </div>
                    <div className={styles.two}>
                      <label>Maximum travel %<input type="number" min="0" max="100" name="travel_max_percent" defaultValue={profile.travel_max_percent ?? ''} /></label>
                      <label>Relocation<select name="relocation_preference" defaultValue={profile.relocation_preference ?? ''}><option value="">Not specified</option><option value="none">No relocation</option><option value="consider">Will consider</option><option value="preferred">Relocation preferred</option></select></label>
                    </div>
                    <label>Equity<select name="equity_preference" defaultValue={profile.equity_preference ?? ''}><option value="">Not specified</option><option value="not_important">Not important</option><option value="nice_to_have">Nice to have</option><option value="required">Required</option></select></label>
                    <div className={styles.actions}>
                      <button className="button">Save profile</button>
                      <button className="button secondary" type="button" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </form>
                ) : (
                  <div className={styles.profileView}>
                    <div className={styles.profileHeader}>
                      <div><p className="eyebrow">{profile.is_active ? 'Active profile' : 'Paused profile'}</p><h2>{profile.name}</h2></div>
                      <div className={styles.actions} style={{ marginTop: 0 }}>
                        <button className="button secondary" onClick={() => setEditingId(profile.id)}>Edit profile</button>
                        {profile.is_active ? (
                          <button className="button ghost" onClick={() => setActive(profile, false)}>Pause</button>
                        ) : (
                          <button className="button ghost" onClick={() => setActive(profile, true)}>Reactivate</button>
                        )}
                      </div>
                    </div>
                    <div className={styles.tags}>{profile.target_titles.length ? profile.target_titles.map((title) => <span className={styles.tag} key={title}>{title}</span>) : <span className={styles.tag}>No target titles</span>}</div>
                    <dl className={styles.details}>
                      <div><dt>Industries</dt><dd>{profile.industries.join(', ') || 'Not set'}</dd></div>
                      <div><dt>Locations</dt><dd>{[...profile.countries, ...profile.states_regions].join(', ') || 'Not set'}</dd></div>
                      <div><dt>Work types</dt><dd>{profile.work_types.join(', ') || 'Not set'}</dd></div>
                      <div><dt>Target base</dt><dd>{money(profile.target_base)}</dd></div>
                      <div><dt>Total compensation</dt><dd>{money(profile.target_total_comp)}</dd></div>
                      <div><dt>Equity</dt><dd>{EQUITY_LABELS[profile.equity_preference ?? ''] ?? 'Not specified'}</dd></div>
                      <div><dt>Keywords</dt><dd>{profile.include_keywords.join(', ') || 'Not set'}</dd></div>
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
                <select value={profile.default_resume_id ?? ''} onChange={(event) => void assignResume(profile.id, event.target.value)}>
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
