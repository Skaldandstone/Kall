'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { METER_LABELS, PLANS, nextPlanAfter, refillsOn } from '../lib/plans';
import styles from './PlanLimitDialog.module.css';

/**
 * The paywall, raised whenever the API refuses something on plan grounds.
 *
 * Mounted once in the root layout and driven by a window event, so any call
 * site anywhere in the app gets it without knowing this component exists --
 * `fetchKall` in lib/api.ts dispatches the event on a 402.
 *
 * It leads with when the allowance comes back, not with the price. Someone who
 * has used five applications on a Thursday mostly wants to know whether to
 * wait until Monday; treating that person as a conversion opportunity first
 * and a user second is how a limit starts to feel like a trap.
 */

export type PlanLimitDetail = {
  meter: string;
  plan: string;
  limit: number | null;
  period: string;
  message: string;
};

declare global {
  interface WindowEventMap {
    'kall:plan-limit': CustomEvent<PlanLimitDetail>;
  }
}

export function showPlanLimit(detail: PlanLimitDetail) {
  window.dispatchEvent(new CustomEvent<PlanLimitDetail>('kall:plan-limit', { detail }));
}

export default function PlanLimitDialog() {
  const [detail, setDetail] = useState<PlanLimitDetail | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setDetail(null), []);

  useEffect(() => {
    const onLimit = (event: WindowEventMap['kall:plan-limit']) => setDetail(event.detail);
    window.addEventListener('kall:plan-limit', onLimit);
    return () => window.removeEventListener('kall:plan-limit', onLimit);
  }, []);

  useEffect(() => {
    if (!detail) return;
    // Focus moves into the dialog so a keyboard user is not left behind on the
    // page underneath, and Escape closes it like any other dialog.
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail, close]);

  if (!detail) return null;

  const upgrade = nextPlanAfter(detail.plan);
  const refill = refillsOn(detail.period);
  const meter = METER_LABELS[detail.meter] ?? detail.meter;

  return (
    <div className={styles.backdrop} onClick={close}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-limit-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <button className={styles.close} type="button" onClick={close} aria-label="Close">
          ×
        </button>

        <span className="eyebrow">Plan limit</span>
        <h2 id="plan-limit-title">
          {detail.limit === null
            ? `You have reached your ${meter} limit.`
            : `That was your ${detail.limit === 1 ? '' : `${detail.limit}th `}${meter.replace(/s$/, '')} ${
                detail.period === 'week' ? 'this week' : 'this month'
              }.`}
        </h2>

        {refill ? (
          <p className={styles.refill}>
            Your allowance refills on <strong>{refill}</strong>. Nothing is lost in the
            meantime — everything you have saved stays where it is.
          </p>
        ) : (
          <p className={styles.refill}>{detail.message}</p>
        )}

        {upgrade ? (
          <>
            <p className={styles.orUpgrade}>Or move up now:</p>
            <div className={styles.plans}>
              {PLANS.filter((plan) => plan.id === upgrade.id || plan.id === 'premium')
                .filter((plan, index, all) => all.findIndex((p) => p.id === plan.id) === index)
                .map((plan) => (
                  <article
                    key={plan.id}
                    className={`${styles.plan} ${plan.id === upgrade.id ? styles.recommended : ''}`}
                  >
                    <header>
                      <h3>{plan.name}</h3>
                      <p className={styles.price}>
                        <strong>{plan.price}</strong>
                        {plan.cadence}
                      </p>
                    </header>
                    <p className={styles.pitch}>{plan.pitch}</p>
                    <ul>
                      {plan.lines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                    <a className="button" href={`/billing?plan=${plan.id}`}>
                      Choose {plan.name}
                    </a>
                  </article>
                ))}
            </div>
          </>
        ) : null}

        <button className="button ghost" type="button" onClick={close}>
          Not now
        </button>
      </div>
    </div>
  );
}
