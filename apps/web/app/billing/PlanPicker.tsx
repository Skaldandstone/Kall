'use client';

import { useEffect, useState } from 'react';
import KallMark from '../components/KallMark';
import { showToast } from '../components/ToastHost';
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

  useEffect(() => {
    void (async () => {
      const body = await getKall<Usage>('/me/usage');
      if (body) setUsage(body);
      else setMessage('Could not load your usage.');
    })();
  }, []);

  async function choose(plan: string) {
    // Stripe is not wired up yet. Rather than a dead button, say so plainly and
    // record the intent -- an upgrade that silently does nothing is worse than
    // one that admits it is not ready.
    const response = await fetchKall('/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
    if (response.ok) {
      const { url } = await response.json();
      window.location.href = url;
      return;
    }
    if (response.status === 503) {
      showToast('Payments are not switched on yet. Nothing has been charged.', 'info');
      return;
    }
    showToast('That plan could not be started. Nothing has been charged.', 'error');
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
              <button className="button" type="button" onClick={() => choose(plan.id)}>
                Choose {plan.name}
              </button>
            )}
          </article>
        ))}
      </section>

      {message && <p className="notice">{message}</p>}
    </main>
  );
}
