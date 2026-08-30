'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AppNav from '../../components/AppNav';
import flow from '../../components/CurrentFlow.module.css';
import { hideSearchResult } from '../../lib/searchResultState';
import { showToast } from '../../components/ToastHost';
import { fetchKall } from '../../lib/api';

type Resume = { id: number; name: string; is_default?: boolean };
type Profile = { id: number; name: string; default_resume_id?: number | null };
type Application = {
  id: number;
  status: string;
  customized_resume_path?: string | null;
  cover_letter_path?: string | null;
  unanswered_questions: string[];
  sensitive_fields_present: boolean;
  prepared_payload?: Record<string, unknown>;
};

async function errorMessage(response: Response, fallback: string) {
  try {
    const payload = await response.json();
    if (typeof payload.detail === 'string') return payload.detail;
    return fallback;
  } catch { return fallback; }
}

export default function NewApplicationPage() {
  return <Suspense fallback={null}><NewApplicationForm /></Suspense>;
}

function NewApplicationForm() {
  const params = useSearchParams();
  const existingJobId = params.get('job') || '';
  const externalUrl = params.get('external_url') || '';
  const externalTitle = params.get('title') || 'Selected opportunity';
  const externalSnippet = params.get('snippet') || '';
  const requestedProfileId = params.get('profile') || '';
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [resumeId, setResumeId] = useState('');
  const [profileId, setProfileId] = useState(params.get('profile') || '');
  const [customizeResume, setCustomizeResume] = useState(true);
  const [generateCoverLetter, setGenerateCoverLetter] = useState(true);
  const [applicationMode, setApplicationMode] = useState<'assisted' | 'automatic'>('assisted');
  const [message, setMessage] = useState('');
  const [application, setApplication] = useState<Application | null>(null);
  const [preparing, setPreparing] = useState(false);
  // Resume and profile selections are populated by the fetch below. Without
  // this gate the button is clickable before they resolve, and prepare() sends
  // resume_id: null -- silently producing an application with no resume
  // attached, which the user only discovers later at the autofill step.
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [optionsError, setOptionsError] = useState('');

  const loadOptions = useCallback(async (signal?: AbortSignal) => {
    setLoadingOptions(true);
    setOptionsError('');
    try {
      const [resumeResponse, profileResponse] = await Promise.all([
        fetchKall(`/me/resumes`, { signal }),
        fetchKall(`/me/professional-profiles`, { signal }),
      ]);
      if (resumeResponse.status === 401 || profileResponse.status === 401) {window.location.replace('/sign-in'); return; }
      if (!resumeResponse.ok || !profileResponse.ok) throw new Error('Unable to load your profiles and resumes. Your choices have not been changed.');
      const loadedResumes: Resume[] = await resumeResponse.json();
      const loadedProfiles: Profile[] = await profileResponse.json();
      setResumes(loadedResumes); setProfiles(loadedProfiles);
      const requestedProfile = loadedProfiles.find((item: Profile) => String(item.id) === requestedProfileId);
      const firstProfile = requestedProfile || loadedProfiles[0];
      setProfileId((current) => loadedProfiles.some((item) => String(item.id) === current) ? current : firstProfile ? String(firstProfile.id) : '');
      const preferredResume = loadedResumes.find((item: Resume) => item.id === firstProfile?.default_resume_id) || loadedResumes.find((item: Resume) => item.is_default) || loadedResumes[0];
      setResumeId((current) => loadedResumes.some((item) => String(item.id) === current) ? current : preferredResume ? String(preferredResume.id) : '');
    } catch (error) {
      if (signal?.aborted) return;
      setOptionsError(error instanceof Error ? error.message : 'Unable to load your profiles and resumes.');
    } finally { if (!signal?.aborted) setLoadingOptions(false); }
  }, [requestedProfileId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadOptions(controller.signal);
    return () => controller.abort();
  }, [loadOptions]);

  function selectProfile(value: string) {
    setProfileId(value);
    const preferred = profiles.find((profile) => String(profile.id) === value)?.default_resume_id;
    if (preferred && resumes.some((resume) => resume.id === preferred)) setResumeId(String(preferred));
  }

  useEffect(() => { setApplication(null); }, [profileId, resumeId, customizeResume, generateCoverLetter, applicationMode]);

  async function resolveJobId() {
    if (existingJobId) return Number(existingJobId);
    if (!externalUrl) throw new Error('No job was selected. Return to Opportunities and choose Apply with Kall.');
    const response = await fetchKall(`/jobs/import-search-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: externalUrl, title: externalTitle, snippet: externalSnippet, source: 'google_cse' }),
    });
    if (!response.ok) throw new Error(await errorMessage(response, 'Unable to import this job into Kall.'));
    const job = await response.json();
    return Number(job.id);
  }

  async function prepare() {
    if (preparing || loadingOptions || optionsError) return;
    if (!profileId) { showToast('Select a professional profile first.', 'error'); return; }
    setPreparing(true);
    setMessage('Importing the role and preparing your application…');
    try {
      const jobId = await resolveJobId();
      const response = await fetchKall(`/applications/prepare-options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: jobId,
          professional_profile_id: Number(profileId),
          resume_id: resumeId ? Number(resumeId) : null,
          customize_resume: customizeResume,
          generate_cover_letter: generateCoverLetter,
          application_mode: applicationMode,
        }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, 'Unable to prepare this application.'));
      const prepared = await response.json() as Application;
      setApplication(prepared);
      if (prepared.status === 'submitted' && externalUrl) {
        hideSearchResult(externalUrl, externalTitle, 'applied_kall');
        showToast('Application submitted and removed from future search results.', 'success');
      }
      setMessage(prepared.status === 'submitted' ? 'Application submitted successfully.' : 'Application prepared. Review and explicit approval are required before submission.');
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Unable to prepare this application.';
      setMessage(text); showToast(text, 'error');
    } finally { setPreparing(false); }
  }

  return <main className={`app-shell ${flow.shell}`}>
    <AppNav current="applications" />
    <section className="hero" style={{ paddingBottom: 36 }}><span className="eyebrow">Application preparation</span><h1>Prepare your application.</h1><p>Kall can pair the role with a stored profile and resume, draft tailored documents, and prepare an assisted or automatic application workflow for your review.</p></section>
    <div className="application-prep-columns">
      <section className="card"><span className="pill">Selected role</span><h2 style={{ marginTop: 16 }}>{externalTitle}</h2><p>{externalSnippet || 'The complete posting will remain available through the original job link.'}</p>{externalUrl && <a className="button secondary" href={externalUrl} target="_blank" rel="noreferrer" style={{ marginTop: 18 }}>View original posting</a>}</section>
      <section className="card form" aria-busy={loadingOptions || preparing}>
        {optionsError && <div role="alert"><p>{optionsError}</p><button className="button secondary" type="button" onClick={() => void loadOptions()}>Retry loading options</button></div>}
        {!loadingOptions && !optionsError && !profiles.length && <p role="status">Create a career profile before preparing this application. <a className="text-link" href="/profiles">Create a profile</a></p>}
        {!loadingOptions && !optionsError && !resumes.length && <p role="status">You have no saved resumes. <a className="text-link" href="/resumes">Upload a resume</a> to include it in this application.</p>}
        <label htmlFor="application-profile"><span className="muted">Professional profile</span></label><select id="application-profile" className="input" value={profileId} disabled={loadingOptions || preparing} onChange={(event) => selectProfile(event.target.value)}><option value="">Select a profile</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select>
        <label htmlFor="application-resume"><span className="muted">Resume</span></label><select id="application-resume" className="input" value={resumeId} disabled={loadingOptions || preparing} onChange={(event) => setResumeId(event.target.value)}><option value="">No resume selected</option>{resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.name}</option>)}</select>
        <fieldset className="application-options" disabled={preparing}><legend>AI document preparation</legend><label className="check-row"><input type="checkbox" checked={customizeResume} onChange={(event) => setCustomizeResume(event.target.checked)} />Customize the selected resume for this role</label><label className="check-row"><input type="checkbox" checked={generateCoverLetter} onChange={(event) => setGenerateCoverLetter(event.target.checked)} />Generate a role-specific cover letter draft</label></fieldset>
        <fieldset className="application-options" disabled={preparing}><legend>Application mode</legend><label className="check-row"><input type="radio" name="mode" checked={applicationMode === 'assisted'} onChange={() => setApplicationMode('assisted')} />Assisted: Kall prepares the package and guides me through the form</label><label className="check-row"><input type="radio" name="mode" checked={applicationMode === 'automatic'} onChange={() => setApplicationMode('automatic')} />Automatic where supported: Kall prepares autofill data, then asks for final approval before submission</label></fieldset>
        <button className="button" type="button" onClick={prepare} disabled={preparing || loadingOptions || !!optionsError || !profileId || (!existingJobId && !externalUrl)}>{preparing ? 'Preparing application…' : loadingOptions ? 'Loading your options…' : 'Prepare application'}</button>
        {!existingJobId && !externalUrl && <p role="status">No role is selected. <a className="text-link" href="/search">Find an opportunity</a> and choose Apply with Kall.</p>}
        <p className="notice" aria-live="polite">{message}</p>
      </section>
    </div>
    {application && <section className="card" style={{ marginTop: 24 }}><span className="pill">{application.status}</span><h2 style={{ marginTop: 16 }}>Review checklist</h2><div className="grid"><article className="card"><h3>Resume</h3><p>{application.customized_resume_path || 'Original selected resume'}</p></article><article className="card"><h3>Cover letter</h3><p>{application.cover_letter_path || 'Not requested'}</p></article><article className="card"><h3>Submission</h3><p>Explicit review and approval are required before Kall submits or assists with submission.</p></article></div><p style={{ marginTop: 18 }}><strong>Open questions:</strong> {application.unanswered_questions.join(' · ') || 'None'}</p><p style={{ marginTop: 10 }}><strong>Sensitive fields:</strong> {application.sensitive_fields_present ? 'Confirmation required' : 'None'}</p><a className="button" href={`/applications/${application.id}`} style={{ marginTop: 20 }}>Continue to application review</a></section>}
  </main>;
}
