'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { showToast } from '../../components/ToastHost';

const API = '/api/kall';

type Connection = {
  id: number;
  provider: 'gmail' | 'outlook';
  status: string;
  scope: string | null;
  last_synced_at: string | null;
  last_error: string | null;
};

const PROVIDERS: Array<{ key: 'gmail' | 'outlook'; label: string }> = [
  { key: 'gmail', label: 'Gmail' },
  { key: 'outlook', label: 'Outlook' },
];

export default function EmailConnectionSettings() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const searchParams = useSearchParams();

  async function load() {
    const response = await fetch(`${API}/me/email-connections`);
    if (response.ok) setConnections(await response.json());
  }

  useEffect(() => {
    void load();
    const connected = searchParams.get('connected');
    if (connected) showToast(`${connected === 'gmail' ? 'Gmail' : 'Outlook'} connected.`, 'success');
  }, [searchParams]);

  async function connect(provider: 'gmail' | 'outlook') {
    setBusy(provider);
    try {
      const response = await fetch(`${API}/me/email-connections/${provider}/authorize`, { method: 'POST' });
      if (response.status === 503) {
        showToast(`${provider === 'gmail' ? 'Gmail' : 'Outlook'} connection isn't available yet.`, 'error');
        return;
      }
      if (!response.ok) { showToast('Unable to start that connection.', 'error'); return; }
      const data = await response.json() as { authorize_url: string };
      window.location.href = data.authorize_url;
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(id: number) {
    setBusy(`disconnect-${id}`);
    try {
      const response = await fetch(`${API}/me/email-connections/${id}`, { method: 'DELETE' });
      if (!response.ok) { showToast('Unable to disconnect.', 'error'); return; }
      await load();
      showToast('Disconnected.', 'success');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      {PROVIDERS.map((provider) => {
        const existing = connections.find((c) => c.provider === provider.key);
        return (
          <section className="card" key={provider.key}>
            <h2>{provider.label}</h2>
            {existing ? (
              <>
                <p className="notice">
                  {existing.status === 'connected' ? 'Connected' : existing.status === 'needs_reauth' ? 'Needs reconnecting' : existing.status}
                  {existing.last_synced_at ? ` · last synced ${new Date(existing.last_synced_at).toLocaleString()}` : ' · not synced yet'}
                </p>
                {existing.last_error && <p className="notice">{existing.last_error}</p>}
                <button className="button ghost" disabled={busy === `disconnect-${existing.id}`} onClick={() => void disconnect(existing.id)}>
                  Disconnect
                </button>
              </>
            ) : (
              <>
                <p>Kall will only ever read mail — never send, delete, or change anything.</p>
                <button className="button" disabled={busy === provider.key} onClick={() => void connect(provider.key)}>
                  {busy === provider.key ? 'Connecting…' : `Connect ${provider.label}`}
                </button>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
