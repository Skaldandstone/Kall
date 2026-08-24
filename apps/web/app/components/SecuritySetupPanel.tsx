'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { decodeBase64Url, encodeBase64Url } from '../../lib/webauthn-bytes';

const CONNECTABLE_PROVIDERS = [
  ['google', 'Google'],
  ['linkedin', 'LinkedIn'],
  ['github', 'GitHub'],
] as const;

const LINK_ERROR_MESSAGES: Record<string, string> = {
  already_connected: 'That account is already connected to a different Kall account.',
  session_expired: 'Your session expired before the connection finished. Please try again.',
};

type SecurityStatus = { totp_enabled: boolean; passkeys: { id: number; name: string }[]; providers: string[] };

export default function SecuritySetupPanel({ onDismiss }: { onDismiss?: () => void }) {
  const [message, setMessage] = useState('');
  const [secret, setSecret] = useState('');
  const [uri, setUri] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);

  function token() {
    const value = localStorage.getItem('kall_token');
    if (!value) { window.location.replace('/login'); throw new Error('Missing session'); }
    return value;
  }

  async function load() {
    const response = await fetch('/api/kall/auth/security', { headers: { Authorization: `Bearer ${token()}` } });
    if (response.status === 401) { localStorage.removeItem('kall_token'); window.location.replace('/login'); return; }
    if (response.ok) setStatus(await response.json());
  }

  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    const linked = params.get('linked');
    const error = params.get('error');
    if (linked) setMessage(`Connected to ${linked[0].toUpperCase()}${linked.slice(1)}.`);
    else if (error) setMessage(LINK_ERROR_MESSAGES[error] || 'Could not connect that account.');
    if (linked || error) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  async function connectProvider(provider: string) {
    setMessage('');
    setConnecting(provider);
    try {
      const returnTo = encodeURIComponent(window.location.pathname);
      const response = await fetch(`/api/kall/auth/oauth/${provider}/link/start?return_to=${returnTo}`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` } });
      const data = await response.json();
      if (!response.ok) { setMessage(data.detail || 'Unable to start the connection.'); return; }
      window.location.assign(data.url);
    } catch {
      setMessage('Kall could not reach the API. Please try again.');
    } finally {
      setConnecting(null);
    }
  }

  async function beginTotp() {
    const response = await fetch('/api/kall/auth/totp/setup', { method: 'POST', headers: { Authorization: `Bearer ${token()}` } });
    const data = await response.json();
    if (!response.ok) { setMessage(data.detail || 'Unable to begin authenticator setup.'); return; }
    setSecret(data.secret);
    setUri(data.otpauth_uri);
    setQrDataUrl(await QRCode.toDataURL(data.otpauth_uri, { width: 200, margin: 1 }));
    setMessage('Scan the QR code with your authenticator app, then enter its six-digit code.');
  }

  async function verifyTotp() {
    const response = await fetch('/api/kall/auth/totp/verify', { method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const data = await response.json();
    setMessage(response.ok ? 'Authenticator-app 2FA is enabled.' : data.detail || 'The code was not accepted.');
    if (response.ok) { setSecret(''); setUri(''); setQrDataUrl(''); setCode(''); await load(); }
  }

  async function addPasskey() {
    setMessage('Waiting for your device…');
    try {
      const response = await fetch('/api/kall/auth/passkeys/register/options', { method: 'POST', headers: { Authorization: `Bearer ${token()}` } });
      const options = await response.json();
      if (!response.ok) throw new Error(options.detail || 'Unable to start passkey setup.');
      const challenge = encodeBase64Url(decodeBase64Url(options.challenge));
      options.challenge = decodeBase64Url(options.challenge);
      options.user.id = decodeBase64Url(options.user.id);
      options.excludeCredentials = (options.excludeCredentials || []).map((item: { id: string }) => ({ ...item, id: decodeBase64Url(item.id) }));
      const created = await navigator.credentials.create({ publicKey: options }) as PublicKeyCredential | null;
      if (!created) throw new Error('Passkey creation was cancelled.');
      const attestation = created.response as AuthenticatorAttestationResponse;
      const credential = { id: created.id, rawId: encodeBase64Url(created.rawId), type: created.type, response: { attestationObject: encodeBase64Url(attestation.attestationObject), clientDataJSON: encodeBase64Url(attestation.clientDataJSON), transports: attestation.getTransports?.() || [] } };
      const complete = await fetch('/api/kall/auth/passkeys/register/complete', { method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge, credential, name: 'Primary passkey' }) });
      const data = await complete.json();
      if (!complete.ok) throw new Error(data.detail || 'Passkey registration failed.');
      setMessage('Your passkey is ready.'); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Passkey registration failed.'); }
  }

  return (
    <>
      <section className="hero" style={{ paddingBottom: 30 }}>
        <span className="eyebrow">Account security</span>
        <h1>Protect your Kall account.</h1>
        <p>Add a passkey, authenticator-app 2FA, or both. You can return to this later from Settings.</p>
      </section>
      <div className="two">
        <section className="card">
          <h2>Passkey</h2>
          <p>Scan a QR code with your phone, or use Face ID, Touch ID, Windows Hello, or a hardware security key on this device.</p>
          <p>{status?.passkeys.length || 0} passkey(s) registered</p>
          <button className="button" onClick={addPasskey}>Create a passkey</button>
        </section>
        <section className="card">
          <h2>Authenticator app</h2>
          <p>{status?.totp_enabled ? 'Authenticator-app 2FA is enabled.' : 'Use a six-digit code from your preferred authenticator app.'}</p>
          {!secret && !status?.totp_enabled && <button className="button" onClick={beginTotp}>Set up authenticator</button>}
          {secret && (
            <div className="form">
              {qrDataUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={qrDataUrl} alt="Scan with your authenticator app" width={200} height={200} style={{ background: '#fff', padding: 8, borderRadius: 8 }} />
              )}
              <details>
                <summary className="muted" style={{ cursor: 'pointer' }}>Can&apos;t scan? Enter the key manually</summary>
                <p><code>{secret}</code></p>
                <a href={uri}>Open in authenticator app</a>
              </details>
              <input className="input" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" placeholder="6-digit code" />
              <button className="button" onClick={verifyTotp}>Verify and enable</button>
            </div>
          )}
        </section>
      </div>
      <section className="card" style={{ marginTop: 20 }}>
        <h2>Connected accounts</h2>
        <p>Sign in with Google, LinkedIn, or GitHub instead of your password by connecting them here.</p>
        <div className="form">
          {CONNECTABLE_PROVIDERS.map(([key, label]) => {
            const connected = status?.providers.includes(key) ?? false;
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span>{label}{connected ? ' — connected' : ''}</span>
                {connected
                  ? <span className="muted">Connected</span>
                  : <button className="button secondary" type="button" disabled={connecting === key} onClick={() => connectProvider(key)}>
                      {connecting === key ? 'Connecting…' : `Connect ${label}`}
                    </button>}
              </div>
            );
          })}
        </div>
      </section>
      <p className="notice" aria-live="polite">{message}</p>
      {onDismiss && (
        <div style={{ marginTop: 24 }}>
          <button className="button secondary" type="button" onClick={onDismiss}>Skip for now</button>
        </div>
      )}
    </>
  );
}
