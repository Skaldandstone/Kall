'use client';

import { FormEvent, useMemo, useState } from 'react';
import SocialAuthButtons from '../components/SocialAuthButtons';
import { countries, countryName, regionsForCountry } from '../../lib/location-data';

type AuthResponse = { access_token: string };

export default function Register() {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [countryCode, setCountryCode] = useState('');
  const [regionCode, setRegionCode] = useState('');
  const regions = useMemo(() => regionsForCountry(countryCode), [countryCode]);
  const selectedRegion = regions.find((region) => region.code === regionCode)?.name ?? null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(''); setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') || '');
    const confirmation = String(form.get('password_confirmation') || '');
    if (password !== confirmation) { setMessage('Passwords do not match.'); setSubmitting(false); return; }
    try {
      const response = await fetch('/api/kall/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: form.get('full_name'), email: form.get('email'), password, country: countryName(countryCode), state_region: selectedRegion }),
      });
      const data = (await response.json()) as AuthResponse & { detail?: string | unknown[] };
      if (!response.ok) {
        const detail = Array.isArray(data.detail) ? data.detail.map((item) => JSON.stringify(item)).join(', ') : data.detail;
        setMessage(typeof detail === 'string' ? detail : 'Account creation failed.'); return;
      }
      localStorage.setItem('kall_token', data.access_token);
      window.location.assign('/onboarding');
    } catch { setMessage('Kall could not reach the API. Please try again.'); }
    finally { setSubmitting(false); }
  }

  return <main className="shell"><div className="card" style={{ maxWidth: 560, margin: '70px auto' }}>
    <a className="brand" href="/" aria-label="Kall home">Kall</a>
    <h1>Create your account</h1><p>Start your private career workspace, then secure it with a passkey or authenticator app.</p>
    <SocialAuthButtons />
    <p className="muted" style={{ textAlign: 'center' }}>or create an account with email</p>
    <form className="form" onSubmit={submit}>
      <input className="input" name="full_name" placeholder="Full name" required />
      <input className="input" name="email" type="email" placeholder="Email" required />
      <input className="input" name="password" type="password" placeholder="Password (at least 10 characters)" minLength={10} required />
      <input className="input" name="password_confirmation" type="password" placeholder="Confirm password" minLength={10} required />
      <label>Country<select className="input" value={countryCode} onChange={(event) => { setCountryCode(event.target.value); setRegionCode(''); }}><option value="">Select a country</option>{countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}</select></label>
      <label>State or region<select className="input" value={regionCode} onChange={(event) => setRegionCode(event.target.value)} disabled={!countryCode || regions.length === 0}><option value="">{!countryCode ? 'Select a country first' : regions.length === 0 ? 'No regions available' : 'Select a state or region'}</option>{regions.map((region) => <option key={`${countryCode}-${region.code}`} value={region.code}>{region.name}</option>)}</select></label>
      <button className="button" type="submit" disabled={submitting}>{submitting ? 'Creating account…' : 'Create account'}</button>
    </form>
    <p aria-live="polite">{message}</p><p>Already have an account? <a href="/login">Log in</a></p>
  </div></main>;
}
