'use client';

import { useEffect, useId, useState } from 'react';

export type ProfessionalProfileOption = {
  id: number;
  name: string;
};

type Props = {
  name?: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  required?: boolean;
};

export default function ProfessionalProfileSelect({
  name = 'profile_id',
  value,
  onChange,
  label = 'Professional profile',
  required = true,
}: Props) {
  const [profiles, setProfiles] = useState<ProfessionalProfileOption[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const inputId = useId();

  function selectProfile(nextValue: string) {
    onChange(nextValue);
    window.dispatchEvent(new CustomEvent('kall:professional-profile-change', {
      detail: { value: nextValue },
    }));
  }

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    fetch('/api/kall/me/professional-profiles', { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.replace('/sign-in');
          return [];
        }
        if (!response.ok) throw new Error('Unable to load profiles');
        return response.json();
      })
      .then((data: ProfessionalProfileOption[]) => {
        setProfiles(Array.isArray(data) ? data : []);
        if (required && !value && data[0]) selectProfile(String(data[0].id));
        else if (value) window.dispatchEvent(new CustomEvent('kall:professional-profile-change', { detail: { value } }));
        setState('ready');
      })
      .catch((error) => { if (error.name !== 'AbortError') setState('error'); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  return (
    <div>
      <label className="muted" htmlFor={inputId}>{label}{!required && ' (optional)'}</label>
      {state === 'loading' ? (
        <select id={inputId} className="input" disabled><option>Loading profiles…</option></select>
      ) : state === 'error' ? (
        <><select id={inputId} className="input" disabled><option>Profiles could not be loaded</option></select><button className="button ghost" type="button" onClick={() => setAttempt((value) => value + 1)}>Retry profiles</button></>
      ) : profiles.length === 0 ? (
        <>
          <select id={inputId} className="input" disabled><option>No profiles created</option></select>
          <a href="/profiles" className="muted">Create a professional profile</a>
        </>
      ) : (
        <select
          className="input"
          id={inputId}
          name={name}
          value={value}
          onChange={(event) => selectProfile(event.target.value)}
          required={required}
        >
          {!required && <option value="">Search without a profile</option>}
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}
