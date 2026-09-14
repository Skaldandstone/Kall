'use client';

import { useEffect, useState } from 'react';
import { showToast } from '../../components/ToastHost';

const API = '/api/kall';

type CareerProfile = { id: number; name: string };
type SharedSearch = {
  id: number;
  slug: string;
  friend_label: string | null;
  source_profile_id: number | null;
  status: 'awaiting_input' | 'active' | 'revoked';
};

const csv = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);

function shareUrl(slug: string): string {
  return `${window.location.origin}/friend/${slug}`;
}

export default function SharedSearchSettings() {
  const [profiles, setProfiles] = useState<CareerProfile[]>([]);
  const [shares, setShares] = useState<SharedSearch[]>([]);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [profileId, setProfileId] = useState('');
  const [titles, setTitles] = useState('');

  async function load() {
    const [profilesResponse, sharesResponse] = await Promise.all([
      fetch(`${API}/me/career-profiles`),
      fetch(`${API}/me/shared-searches`),
    ]);
    if (profilesResponse.ok) setProfiles(await profilesResponse.json());
    if (sharesResponse.ok) setShares(await sharesResponse.json());
  }

  useEffect(() => { void load(); }, []);

  async function create(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch(`${API}/me/shared-searches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        showToast('Unable to create that share.', 'error');
        return;
      }
      setLabel('');
      setProfileId('');
      setTitles('');
      await load();
      showToast('Share created.', 'success');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(slug: string) {
    try {
      await navigator.clipboard.writeText(shareUrl(slug));
      showToast('Link copied.', 'success');
    } catch {
      showToast(shareUrl(slug), 'success');
    }
  }

  async function revoke(id: number) {
    setBusy(true);
    try {
      const response = await fetch(`${API}/me/shared-searches/${id}`, { method: 'DELETE' });
      if (!response.ok) { showToast('Unable to revoke that share.', 'error'); return; }
      await load();
    } finally {
      setBusy(false);
    }
  }

  const active = shares.filter((share) => share.status !== 'revoked');

  return (
    <div className="stack">
      <section className="card">
        <h2>Share your own profile</h2>
        <p>The friend sees exactly what you'd see — live off your real target titles, locations, and preferences.</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <select className="input" value={profileId} onChange={(e) => setProfileId(e.target.value)} style={{ maxWidth: 260 }}>
            <option value="">Choose a profile…</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            ))}
          </select>
          <button className="button" disabled={busy || !profileId} onClick={() => void create({ source_profile_id: Number(profileId), friend_label: label || null })}>
            Create share
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Fill in a quick profile for them</h2>
        <p>You know roughly what they want — enter a few basics and get a link right away.</p>
        <div className="stack">
          <input className="input" placeholder="Job titles (comma separated)" value={titles} onChange={(e) => setTitles(e.target.value)} />
          <input className="input" placeholder="Friend's name (optional, just for your own list)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <button className="button" disabled={busy || !titles.trim()} onClick={() => void create({ criteria: { target_titles: csv(titles) }, friend_label: label || null })} style={{ alignSelf: 'flex-start' }}>
            Create share
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Send them a link to fill it in themselves</h2>
        <p>No Kall account needed — they answer a short form and get their own matches.</p>
        <button className="button" disabled={busy} onClick={() => void create({ mode: 'invite', friend_label: label || null })}>
          Create invite link
        </button>
      </section>

      <section className="card">
        <h2>Your shares</h2>
        {active.length === 0 && <p className="notice">Nothing shared yet.</p>}
        {active.length > 0 && (
          <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
            {active.map((share) => (
              <li key={share.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <span>
                  {share.friend_label || 'Untitled share'} —{' '}
                  <span className="notice">{share.status === 'awaiting_input' ? 'waiting on their answers' : 'active'}</span>
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="button secondary" onClick={() => void copyLink(share.slug)}>Copy link</button>
                  <button className="button ghost" disabled={busy} onClick={() => void revoke(share.id)}>Revoke</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
