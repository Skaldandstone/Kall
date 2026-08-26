'use client';

import { useEffect, useState } from 'react';

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

  function selectProfile(nextValue: string) {
    onChange(nextValue);
    window.dispatchEvent(new CustomEvent('kall:professional-profile-change', {
      detail: { value: nextValue },
    }));
  }

  useEffect(() => {
    fetch('/api/kall/me/professional-profiles')
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
        if (!value && data[0]) selectProfile(String(data[0].id));
        else if (value) window.dispatchEvent(new CustomEvent('kall:professional-profile-change', { detail: { value } }));
        setState('ready');
      })
      .catch(() => setState('error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <label>
      <span className="muted">{label}</span>
      {state === 'loading' ? (
        <select className="input" disabled><option>Loading profiles…</option></select>
      ) : state === 'error' ? (
        <select className="input" disabled><option>Profiles could not be loaded</option></select>
      ) : profiles.length === 0 ? (
        <>
          <select className="input" disabled><option>No profiles created</option></select>
          <a href="/profiles" className="muted">Create a professional profile</a>
        </>
      ) : (
        <select
          className="input"
          name={name}
          value={value}
          onChange={(event) => selectProfile(event.target.value)}
          required={required}
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.name}</option>
          ))}
        </select>
      )}
    </label>
  );
}
