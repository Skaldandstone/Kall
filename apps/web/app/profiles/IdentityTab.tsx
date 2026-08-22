'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { countries, regionsForCountry } from '../../lib/location-data';

type IdentityProfile = {
  email: string;
  full_name: string;
  preferred_name: string | null;
  city: string | null;
  state_region: string | null;
  country: string | null;
  timezone: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  website_urls: string[];
  portfolio_urls: string[];
  professional_summary: string | null;
};

const emptyProfile: IdentityProfile = {
  email: '',
  full_name: '',
  preferred_name: '',
  city: '',
  state_region: '',
  country: '',
  timezone: '',
  linkedin_url: '',
  github_url: '',
  website_urls: [],
  portfolio_urls: [],
  professional_summary: '',
};

function countryCodeForName(name: string | null): string {
  return countries.find((country) => country.name === name)?.code ?? '';
}

export default function IdentityTab() {
  const [profile, setProfile] = useState<IdentityProfile>(emptyProfile);
  const [countryCode, setCountryCode] = useState('');
  const [message, setMessage] = useState('Loading your profile…');
  const [saving, setSaving] = useState(false);

  const regions = useMemo(() => regionsForCountry(countryCode), [countryCode]);

  useEffect(() => {
    const token = localStorage.getItem('kall_token');
    if (!token) {
      window.location.assign('/login');
      return;
    }

    async function load() {
      try {
        const response = await fetch('/api/kall/me/identity', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (response.status === 401) {
          localStorage.removeItem('kall_token');
          window.location.assign('/login');
          return;
        }
        const data = (await response.json()) as IdentityProfile & { detail?: string };
        if (!response.ok) {
          setMessage(data.detail || 'Unable to load your profile.');
          return;
        }
        setProfile(data);
        setCountryCode(countryCodeForName(data.country));
        setMessage('');
      } catch {
        setMessage('Kall could not load your profile. Please try again.');
      }
    }

    void load();
  }, []);

  function updateField<K extends keyof IdentityProfile>(key: K, value: IdentityProfile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  function changeCountry(code: string) {
    const country = countries.find((option) => option.code === code);
    setCountryCode(code);
    setProfile((current) => ({
      ...current,
      country: country?.name ?? '',
      state_region: '',
    }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = localStorage.getItem('kall_token');
    if (!token) {
      window.location.assign('/login');
      return;
    }

    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/kall/me/identity', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          preferred_name: profile.preferred_name || null,
          phone: null,
          address: null,
          city: profile.city || null,
          state_region: profile.state_region || null,
          postal_code: null,
          country: profile.country || null,
          timezone: profile.timezone || null,
          linkedin_url: profile.linkedin_url || null,
          github_url: profile.github_url || null,
          website_urls: profile.website_urls,
          portfolio_urls: profile.portfolio_urls,
          professional_summary: profile.professional_summary || null,
        }),
      });
      const data = (await response.json()) as { detail?: string };
      if (response.status === 401) {
        localStorage.removeItem('kall_token');
        window.location.assign('/login');
        return;
      }
      setMessage(response.ok ? 'Identity saved.' : data.detail || 'Unable to save your profile.');
    } catch {
      setMessage('Kall could not save your profile. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h1>Identity profile</h1>
      <p>Your registration and onboarding information is loaded automatically. Update it here whenever your details change.</p>
      <form className="form" onSubmit={save}>
        <div className="two">
          <label>
            Full name
            <input className="input" value={profile.full_name} readOnly />
          </label>
          <label>
            Email
            <input className="input" type="email" value={profile.email} readOnly />
          </label>
        </div>
        <label>
          Preferred name
          <input
            className="input"
            name="preferred_name"
            value={profile.preferred_name ?? ''}
            onChange={(event) => updateField('preferred_name', event.target.value)}
          />
        </label>
        <div className="two">
          <label>
            Country
            <select
              className="input"
              name="country"
              value={countryCode}
              onChange={(event) => changeCountry(event.target.value)}
            >
              <option value="">Select a country</option>
              {countries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            State or region
            <select
              className="input"
              name="state_region"
              value={profile.state_region ?? ''}
              onChange={(event) => updateField('state_region', event.target.value)}
              disabled={!countryCode || regions.length === 0}
            >
              <option value="">
                {!countryCode
                  ? 'Select a country first'
                  : regions.length
                    ? 'Select a state or region'
                    : 'No regions available'}
              </option>
              {regions.map((region) => (
                <option key={`${countryCode}-${region.code}`} value={region.name}>
                  {region.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="two">
          <label>
            City
            <input
              className="input"
              name="city"
              value={profile.city ?? ''}
              onChange={(event) => updateField('city', event.target.value)}
            />
          </label>
          <label>
            Time zone
            <input
              className="input"
              name="timezone"
              value={profile.timezone ?? ''}
              onChange={(event) => updateField('timezone', event.target.value)}
              placeholder="e.g. America/Los_Angeles"
            />
          </label>
        </div>
        <div className="two">
          <label>
            LinkedIn
            <input
              className="input"
              name="linkedin_url"
              value={profile.linkedin_url ?? ''}
              onChange={(event) => updateField('linkedin_url', event.target.value)}
            />
          </label>
          <label>
            GitHub
            <input
              className="input"
              name="github_url"
              value={profile.github_url ?? ''}
              onChange={(event) => updateField('github_url', event.target.value)}
            />
          </label>
        </div>
        <label>
          Websites, one per line
          <textarea
            className="input"
            name="website_urls"
            rows={3}
            value={profile.website_urls.join('\n')}
            onChange={(event) =>
              updateField(
                'website_urls',
                event.target.value.split('\n').map((value) => value.trim()).filter(Boolean),
              )
            }
          />
        </label>
        <label>
          Portfolios, one per line
          <textarea
            className="input"
            name="portfolio_urls"
            rows={3}
            value={profile.portfolio_urls.join('\n')}
            onChange={(event) =>
              updateField(
                'portfolio_urls',
                event.target.value.split('\n').map((value) => value.trim()).filter(Boolean),
              )
            }
          />
        </label>
        <label>
          Professional summary
          <textarea
            className="input"
            name="professional_summary"
            rows={7}
            value={profile.professional_summary ?? ''}
            onChange={(event) => updateField('professional_summary', event.target.value)}
          />
        </label>
        <button className="button" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save identity'}
        </button>
      </form>
      <p role="status" aria-live="polite">{message}</p>
    </div>
  );
}
