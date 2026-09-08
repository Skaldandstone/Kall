'use client';

import { useEffect, useState } from 'react';
import KallMark from '../components/KallMark';
import { fetchKall, getKall } from '../lib/api';
import { METER_LABELS, PLANS, refillsOn } from '../lib/plans';
import styles from './billing.module.css';

type MeterState = {
  used: number;
  limit: number | null;
  period: string;
  remaining: number | null;
};

type Usage = {
  plan: string;
  billing_exempt: boolean;
  meters: Record<string, MeterState>;
};

const MB = 1024 * 1024;

function formatUsed(meter: string, state: MeterState): string {
  if (meter === 'storage_bytes') {
    const used = (state.used / MB).toFixed(state.used < MB ? 2 : 0);
    return state.limit === null ? `${used} MB used` : `${used} of ${Math.round(state.limit / MB)} MB`;
  }
  return state.limit === null ? `${state.used} used` : `${state.used} of ${state.limit}`;
}

/** 0–1, or null when there is no ceiling to be a fraction of. */
function fraction(state: MeterState): number | null {
  if (state.limit === null || state.limit === 0) return null;
  return Math.min(1, state.used / state.limit);
}

export default function PlanPicker() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [message, setMessage] = useState('');
  const [billing, setBilling] = useState<{
    enabled: boolean;
    can_manage: boolean;
    livemode: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [body, status] = await Promise.all([
      getKall<Usage>('/me/usage'),
      getKall<{ enabled: boolean; can_manage: boolean; livemode: boolean }>('/billing/status'),
    ]);
    if (body) setUsage(body);
    setBilling(status);
    if (!body || !status) setMessage('Could not load billing details. Try again before starting a payment.');
    else setMessage(previous => previous.startsWith('Could not load billing details.') ? '' : previous);
  }

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('checkout') === 'returned') {
      setMessage('Checkout returned. Your plan changes only after payment confirmation. Refresh your usage if it is still pending.');
    }
    void refresh();
  }, []);

  async function openBilling(plan?: string) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    // Someone already on a paid plan who picks another plan is changing price on
    // their live subscription, not starting a new one -- only the portal prorates
    // that. Checkout is for a first subscription, where there is nothing to prorate.
    const changingPlan = plan && current !== 'free';
    const usesPortal = !plan || changingPlan;
    try {
      const response = await fetchKall(usesPortal ? '/billing/portal' : '/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(plan ? { body: JSON.stringify({ plan }) } : {}),
      });
      if (response.ok) {
        const { url } = await response.json();
        const target = new URL(url);
        if (target.protocol !== 'https:' || target.hostname !== (usesPortal ? 'billing.stripe.com' : 'checkout.stripe.com')) {
          throw new Error('Unexpected billing redirect');
        }
        window.location.href = target.href;
        return;
      }
      setMessage(response.status === 409
        ? 'An existing Checkout or subscription needs attention. Use Manage billing, or finish the open Checkout before starting another.'
        : 'Billing is temporarily unavailable. Retry here to resume the same attempt, or check Manage billing.');
    } catch {
      setMessage('Could not confirm the billing request. Retry here to resume the same attempt, or check Manage billing.');
    } finally {
      setBusy(false);
    }
  }

  const current = usage?.plan ?? 'free';

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/">
          <KallMark />
          Kall
        </a>
        <nav>
          <a href="/search">Opportunities</a>
          <a href="/applications">Applications</a>
        </nav>
      </header>

      <section className="hero" style={{ paddingTop: 8, paddingBottom: 36 }}>
        <span className="eyebrow">Plans</span>
        <h1 style={{ fontSize: 'clamp(40px, 6vw, 68px)' }}>Five a week, free. More when you need it.</h1>
        <p>Allowances refill every week, so a busy Sunday never locks you out until next month.</p>
      </section>

      <section className="card" style={{ marginBottom: 16 }} aria-label="Billing status">
        <p>{billing === null
          ? 'Billing availability has not been confirmed.'
          : !billing.enabled
            ? 'Payments are not switched on. You can keep using your current plan.'
            : billing.livemode
              ? 'Live payments are available.'
              : 'Test payments are available. No real charge will be made.'}</p>
        {message && <p role="status">{message}</p>}
        <div className={styles.actions}>
          <button className="button secondary" type="button" disabled={busy} onClick={() => void refresh()}>Refresh usage</button>
          {billing?.can_manage && <button className="button" type="button" disabled={busy} onClick={() => void openBilling()}>Manage billing</button>}
        </div>
      </section>

      {usage && (
        <section className="card" style={{ marginBottom: 16 }}>
          <span className="eyebrow">This week</span>
          {usage.billing_exempt && (
            <p className="muted">This account is exempt from plan limits.</p>
          )}
          <div className={styles.meters}>
            {Object.entries(usage.meters).map(([meter, state]) => {
              const portion = fraction(state);
              return (
                <div key={meter} className={styles.meter}>
                  <div className={styles.meterHead}>
                    <span>{METER_LABELS[meter] ?? meter}</span>
                    <strong>{formatUsed(meter, state)}</strong>
                  </div>
                  <div
                    className={styles.track}
                    role="progressbar"
                    aria-valuenow={Math.round((portion ?? 0) * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={METER_LABELS[meter] ?? meter}
                  >
                    <span
                      className={`${styles.fill} ${portion !== null && portion >= 0.8 ? styles.nearly : ''}`}
                      style={{ width: `${(portion ?? 0) * 100}%` }}
                    />
                  </div>
                  {state.period !== 'lifetime' && (
                    <p className={styles.refill}>Refills {refillsOn(state.period)}</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className={styles.plans}>
        {PLANS.map((plan) => (
          <article
            key={plan.id}
            className={`card ${styles.plan} ${plan.id === current ? styles.current : ''}`}
          >
            <header className={styles.planHead}>
              <h2>{plan.name}</h2>
              <p className={styles.price}>
                <strong>{plan.price}</strong>
                {plan.cadence}
              </p>
            </header>
            <p className="muted">{plan.pitch}</p>
            <ul className={styles.lines}>
              {plan.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {plan.id === current ? (
              <p className={styles.currentTag}>Your plan</p>
            ) : plan.id === 'free' ? null : (
              <button className="button" type="button" disabled={busy || !billing?.enabled || !usage} onClick={() => void openBilling(plan.id)}>
                Choose {plan.name}
              </button>
            )}
          </article>
        ))}
      </section>

    </main>
  );
}
