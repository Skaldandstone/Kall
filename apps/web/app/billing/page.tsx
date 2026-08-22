'use client';

import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
type BillingStatus = { plan: string; subscription_status: string; used: number; free_limit: number; remaining: number | null; allowed: boolean };

export default function BillingPage() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [message, setMessage] = useState('');

  async function load() {
    const token = localStorage.getItem('kall_token');
    const response = await fetch(`${API}/api/billing/status`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.ok) setStatus(await response.json());
  }

  async function open(path: 'checkout' | 'portal') {
    const token = localStorage.getItem('kall_token');
    const response = await fetch(`${API}/api/billing/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return setMessage('Billing is not available yet. Check Stripe configuration.');
    const data = await response.json();
    window.location.href = data.url;
  }

  useEffect(() => { load(); }, []);

  return <main className="shell">
    <header className="topbar"><a className="brand" href="/">Kall</a><nav><a href="/opportunities">Opportunities</a><a href="/applications">Applications</a></nav></header>
    <section className="hero" style={{ paddingTop: 8, paddingBottom: 42 }}><span className="eyebrow">Kall Plus</span><h1 style={{ fontSize: 'clamp(44px, 7vw, 76px)' }}>Ten applications free. Then $4 a month.</h1><p>Usage is enforced on the server before Kall creates a submission attempt.</p></section>
    <section className="card">
      <span className="eyebrow">Current plan</span>
      <div className="metric"><strong>{status?.plan || 'Loading'}</strong></div>
      <p>{status ? `${status.used} applications used${status.remaining === null ? ' · unlimited while subscribed' : ` · ${status.remaining} free remaining`}` : 'Loading usage…'}</p>
      <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        {status?.plan !== 'plus' && <button className="button" onClick={() => open('checkout')}>Upgrade for $4/month</button>}
        {status?.plan === 'plus' && <button className="button secondary" onClick={() => open('portal')}>Manage subscription</button>}
      </div>
      <p className="notice">{message}</p>
    </section>
  </main>;
}
