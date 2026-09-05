'use client';

import { useMemo, useState } from 'react';
import styles from './SalaryRangeInput.module.css';

type PayBasis = 'hourly' | 'salary';

type Props = {
  minName: string;
  maxName: string;
  basisName: string;
  label: string;
  defaultBasis?: PayBasis;
  /** Always annualized, matching how the backend stores these numbers. */
  defaultMin?: number | null;
  defaultMax?: number | null;
  /** An AI-derived, clearly-unverified rough estimate -- also always annualized. */
  suggestedMin?: number | null;
  suggestedMax?: number | null;
};

//: One hour worked * 40 hours/week * 52 weeks/year -- the same annualizing
//: convention used server-side (see onboarding_ai.py) so a value round-trips
//: to the same hourly figure it started as.
const HOURS_PER_YEAR = 2080;

const HOURLY_STEPS = [0, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 100, 125, 150, 200];
const SALARY_STEPS = [
  0, 40000, 50000, 60000, 70000, 80000, 90000, 100000, 110000, 120000, 130000, 140000, 150000, 160000, 175000, 190000,
  200000, 225000, 250000, 275000, 300000, 350000, 400000,
];

function nearestStep(steps: number[], value: number): number {
  return steps.reduce((closest, step) => (Math.abs(step - value) < Math.abs(closest - value) ? step : closest), steps[0]);
}

function toDisplay(basis: PayBasis, annualized: number): number {
  return basis === 'hourly' ? Math.round(annualized / HOURS_PER_YEAR) : annualized;
}

function toAnnualized(basis: PayBasis, displayed: number): number {
  return basis === 'hourly' ? Math.round(displayed * HOURS_PER_YEAR) : displayed;
}

function formatDisplay(basis: PayBasis, value: number): string {
  return basis === 'hourly' ? `$${value}/hr` : `$${value.toLocaleString()}/yr`;
}

export default function SalaryRangeInput({
  minName,
  maxName,
  basisName,
  label,
  defaultBasis = 'salary',
  defaultMin,
  defaultMax,
  suggestedMin,
  suggestedMax,
}: Props) {
  const [basis, setBasis] = useState<PayBasis>(defaultBasis);
  const [minValue, setMinValue] = useState<number | ''>(
    defaultMin != null ? nearestStep(defaultBasis === 'hourly' ? HOURLY_STEPS : SALARY_STEPS, toDisplay(defaultBasis, defaultMin)) : '',
  );
  const [maxValue, setMaxValue] = useState<number | ''>(
    defaultMax != null ? nearestStep(defaultBasis === 'hourly' ? HOURLY_STEPS : SALARY_STEPS, toDisplay(defaultBasis, defaultMax)) : '',
  );

  const steps = basis === 'hourly' ? HOURLY_STEPS : SALARY_STEPS;

  const hasEstimate = suggestedMin != null && suggestedMax != null;
  const estimateText = useMemo(() => {
    if (!hasEstimate) return '';
    return `${formatDisplay(basis, toDisplay(basis, suggestedMin!))} - ${formatDisplay(basis, toDisplay(basis, suggestedMax!))}`;
  }, [hasEstimate, basis, suggestedMin, suggestedMax]);

  function changeBasis(next: PayBasis) {
    if (next === basis) return;
    // Convert the currently displayed value through annualized dollars so a
    // switch between bases doesn't just re-round the same raw number.
    const nextSteps = next === 'hourly' ? HOURLY_STEPS : SALARY_STEPS;
    setMinValue((current) => (current === '' ? '' : nearestStep(nextSteps, toDisplay(next, toAnnualized(basis, current)))));
    setMaxValue((current) => (current === '' ? '' : nearestStep(nextSteps, toDisplay(next, toAnnualized(basis, current)))));
    setBasis(next);
  }

  function applyEstimate() {
    if (!hasEstimate) return;
    setMinValue(nearestStep(steps, toDisplay(basis, suggestedMin!)));
    setMaxValue(nearestStep(steps, toDisplay(basis, suggestedMax!)));
  }

  return (
    <div className={styles.wrap}>
      <span className={styles.label}>{label}</span>
      <input type="hidden" name={basisName} value={basis} />
      <input type="hidden" name={minName} value={minValue === '' ? '' : toAnnualized(basis, minValue)} />
      <input type="hidden" name={maxName} value={maxValue === '' ? '' : toAnnualized(basis, maxValue)} />

      <div className={styles.basisToggle}>
        <button type="button" className={basis === 'hourly' ? styles.active : ''} onClick={() => changeBasis('hourly')}>
          Hourly
        </button>
        <button type="button" className={basis === 'salary' ? styles.active : ''} onClick={() => changeBasis('salary')}>
          Salaried
        </button>
      </div>

      <div className={styles.range}>
        <select
          aria-label={`${label} minimum`}
          value={minValue}
          onChange={(event) => setMinValue(event.target.value ? Number(event.target.value) : '')}
        >
          <option value="">Minimum</option>
          {steps.map((step) => (
            <option key={step} value={step}>
              {formatDisplay(basis, step)}
            </option>
          ))}
        </select>
        <span>to</span>
        <select
          aria-label={`${label} target`}
          value={maxValue}
          onChange={(event) => setMaxValue(event.target.value ? Number(event.target.value) : '')}
        >
          <option value="">Target</option>
          {steps.map((step) => (
            <option key={step} value={step}>
              {formatDisplay(basis, step)}
            </option>
          ))}
        </select>
      </div>

      {hasEstimate && (
        <div className={styles.estimate}>
          <span>
            Kall&apos;s rough estimate for this role, based on your resume: <b>{estimateText}</b>. This is an
            unverified AI estimate, not confirmed market data.
          </span>
          <button type="button" onClick={applyEstimate}>
            Use this estimate
          </button>
        </div>
      )}
    </div>
  );
}
