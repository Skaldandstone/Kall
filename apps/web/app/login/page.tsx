'use client';

import { FormEvent, useState } from 'react';
import KallMark from '../components/KallMark';
import SocialAuthButtons from '../components/SocialAuthButtons';
import { decodeBase64Url, encodeBase64Url } from '../../lib/webauthn-bytes';

export default function Login() {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/kall/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });
      const data = await response.json();
      if (!response.ok) { setMessage(data.detail || 'Login failed.'); return; }
      localStorage.setItem('kall_token', data.access_token);
      window.location.assign('/dashboard');
    } catch { setMessage('Kall could not reach the API. Please try again.'); }
    finally { setSubmitting(false); }
  }

  async function loginWithPasskey() {
    const email = window.prompt('Enter the email address for your Kall account.');
    if (!email) return;
    setMessage('Waiting for your passkey…');
    try {
      const optionsResponse = await fetch(`/api/kall/auth/passkeys/login/options?email=${encodeURIComponent(email)}`, { method: 'POST' });
      const options = await optionsResponse.json();
      if (!optionsResponse.ok) throw new Error(options.detail || 'No passkey is available for this account.');
      const challenge = encodeBase64Url(decodeBase64Url(options.challenge));
      options.challenge = decodeBase64Url(options.challenge);
      options.allowCredentials = (options.allowCredentials || []).map((item: { id: string }) => ({ ...item, id: decodeBase64Url(item.id) }));
      const assertion = await navigator.credentials.get({ publicKey: options }) as PublicKeyCredential | null;
      if (!assertion) throw new Error('Passkey authentication was cancelled.');
      const response = assertion.response as AuthenticatorAssertionResponse;
      const credential = {
        id: assertion.id,
        rawId: encodeBase64Url(assertion.rawId),
        type: assertion.type,
        response: {
          authenticatorData: encodeBase64Url(response.authenticatorData),
          clientDataJSON: encodeBase64Url(response.clientDataJSON),
          signature: encodeBase64Url(response.signature),
          userHandle: response.userHandle ? encodeBase64Url(response.userHandle) : null,
        },
      };
      const complete = await fetch('/api/kall/auth/passkeys/login/complete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge, credential }),
      });
      const data = await complete.json();
      if (!complete.ok) throw new Error(data.detail || 'Passkey login failed.');
      localStorage.setItem('kall_token', data.access_token);
      window.location.assign('/dashboard');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Passkey login failed.'); }
  }

  return (
    <main className="shell"><div className="card" style={{ maxWidth: 520, margin: '70px auto' }}>
      <a className="brand" href="/" aria-label="Kall home"><KallMark />Kall</a>
      <h1>Welcome back</h1>
      <SocialAuthButtons />
      <p className="muted" style={{ textAlign: 'center' }}>or use your Kall credentials</p>
      <form className="form" onSubmit={submit}>
        <input className="input" name="email" type="email" placeholder="Email" required />
        <input className="input" name="password" type="password" placeholder="Password" required />
        <button className="button" type="submit" disabled={submitting}>{submitting ? 'Logging in…' : 'Log in'}</button>
      </form>
      <button className="button ghost" type="button" onClick={loginWithPasskey}>Log in with a passkey</button>
      <p aria-live="polite">{message}</p>
      <p>New to Kall? <a href="/register">Create an account</a></p>
    </div></main>
  );
}
