'use client';

import { useCallback, useEffect, useState } from 'react';
import AppNav from '../components/AppNav';
import { showToast } from '../components/ToastHost';
import { fetchKall, getKall } from '../lib/api';
import styles from './admin.module.css';

/**
 * Support console.
 *
 * Access is decided by the server, not here: every route under /api/admin
 * returns 404 to a non-admin, so this page rendering for the wrong person
 * would show them nothing. The `denied` state exists to say so plainly rather
 * than leaving an empty screen.
 */

type Meter = { used: number; limit: number | null; period: string; remaining: number | null };

type Account = {
  id: number;
  email: string;
  full_name: string;
  plan: string;
  billing_exempt: boolean;
  is_active: boolean;
  created_at: string;
  usage: { plan: string; billing_exempt: boolean; meters: Record<string, Meter> };
};

type Audit = {
  id: number;
  actor_email: string;
  action: string;
  target_user_id: number;
  detail: Record<string, unknown>;
  occurred_at: string;
};

const MB = 1024 * 1024;

function meterText(meter: string, state: Meter): string {
  if (meter === 'storage_bytes') {
    const used = state.used / MB;
    return state.limit === null
      ? `${used.toFixed(1)} MB`
      : `${used.toFixed(1)} / ${Math.round(state.limit / MB)} MB`;
  }
  return state.limit === null ? `${state.used} (no limit)` : `${state.used} / ${state.limit}`;
}

export default function AdminConsole() {
  const [denied, setDenied] = useState(false);
  const [query, setQuery] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState<Account | null>(null);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const search = useCallback(async (term: string) => {
    const response = await fetchKall(`/admin/users${term ? `?q=${encodeURIComponent(term)}` : ''}`);
    if (response.status === 404) {
      setDenied(true);
      return;
    }
    if (response.ok) setAccounts(await response.json());
  }, []);

  useEffect(() => {
    void search('');
  }, [search]);

  async function open(account: Account) {
    setSelected(account);
    setReason('');
    setAudit((await getKall<Audit[]>(`/admin/audit?target_user_id=${account.id}`)) ?? []);
  }

  async function act(path: string, body: Record<string, unknown>, label: string) {
    if (!selected) return;
    setBusy(true);
    const response = await fetchKall(`/admin/users/${selected.id}${path}`, {
      method: path === '/reset-usage' ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, reason }),
    });
    setBusy(false);
    if (!response.ok) {
      showToast(`${label} failed.`, 'error');
      return;
    }
    const updated: Account = await response.json();
    // Clear the reason after each action. Left in place it silently attached
    // itself to the next change too, so the log claimed a justification the
    // administrator never wrote for it -- worse than no reason at all.
    setReason('');
    setSelected(updated);
    setAccounts((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    setAudit((await getKall<Audit[]>(`/admin/audit?target_user_id=${updated.id}`)) ?? []);
    showToast(`${label} done.`, 'success');
  }

  if (denied) {
    return (
      <main className="shell">
        <AppNav />
        <section className="card" style={{ marginTop: 40 }}>
          <h1>Not available</h1>
          <p className="muted">This account cannot use the support console.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <AppNav />
      <section className="hero" style={{ paddingTop: 32, paddingBottom: 28 }}>
        <span className="eyebrow">Support</span>
        <h1 style={{ fontSize: 'clamp(38px, 6vw, 62px)' }}>Accounts</h1>
        <p>Find an account, see what its plan allows, and change it. Every change is logged.</p>
      </section>

      <div className={styles.layout}>
        <section className="card">
          <form
            className={styles.searchRow}
            onSubmit={(event) => {
              event.preventDefault();
              void search(query);
            }}
          >
            <input
              className="input"
              name="q"
              placeholder="Search by email or name"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button className="button secondary" type="submit">Search</button>
          </form>

          <ul className={styles.results}>
            {accounts.map((account) => (
              <li key={account.id}>
                <button
                  type="button"
                  className={`${styles.result} ${selected?.id === account.id ? styles.active : ''}`}
                  onClick={() => open(account)}
                >
                  <span className={styles.resultName}>{account.full_name || account.email}</span>
                  <span className={styles.resultMeta}>{account.email}</span>
                  <span className={styles.badges}>
                    <span className={styles.badge}>{account.plan}</span>
                    {account.billing_exempt && (
                      <span className={`${styles.badge} ${styles.exempt}`}>exempt</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
            {accounts.length === 0 && <li className="muted">No accounts matched.</li>}
          </ul>
        </section>

        <section className="card">
          {!selected ? (
            <p className="muted">Choose an account to see its usage.</p>
          ) : (
            <div className={styles.detail}>
              <header>
                <h2>{selected.full_name || selected.email}</h2>
                <p className="muted">
                  {selected.email} · joined {new Date(selected.created_at).toLocaleDateString()}
                </p>
              </header>

              <dl className={styles.meters}>
                {Object.entries(selected.usage.meters).map(([meter, state]) => (
                  <div key={meter}>
                    <dt>{meter.replace(/_/g, ' ')}</dt>
                    <dd>
                      {meterText(meter, state)}
                      <span className={styles.period}> / {state.period}</span>
                    </dd>
                  </div>
                ))}
              </dl>

              <label>
                <span className="muted">Reason (recorded in the log)</span>
                <input
                  className="input"
                  name="reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Why this change is being made"
                />
              </label>

              <div className={styles.actions}>
                {['free', 'plus', 'premium'].map((plan) => (
                  <button
                    key={plan}
                    type="button"
                    className="button secondary"
                    disabled={busy || selected.plan === plan}
                    onClick={() => act('/plan', { plan }, `Set ${plan}`)}
                  >
                    Set {plan}
                  </button>
                ))}
              </div>

              <div className={styles.actions}>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    act(
                      '/billing-exempt',
                      { billing_exempt: !selected.billing_exempt },
                      selected.billing_exempt ? 'Exemption removed' : 'Exemption granted',
                    )
                  }
                >
                  {selected.billing_exempt ? 'Remove exemption' : 'Exempt from limits'}
                </button>
                <button
                  type="button"
                  className="button ghost"
                  disabled={busy}
                  onClick={() => act('/reset-usage', {}, 'Usage reset')}
                >
                  Reset this period
                </button>
              </div>

              <section className={styles.audit}>
                <h3>History</h3>
                {audit.length === 0 && <p className="muted">Nothing recorded for this account.</p>}
                <ul>
                  {audit.map((entry) => (
                    <li key={entry.id}>
                      <span className={styles.auditAction}>{entry.action.replace(/_/g, ' ')}</span>
                      <span className="muted">
                        {' '}by {entry.actor_email} · {new Date(entry.occurred_at).toLocaleString()}
                      </span>
                      {typeof entry.detail?.reason === 'string' && entry.detail.reason && (
                        <p className={styles.auditReason}>{entry.detail.reason}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
