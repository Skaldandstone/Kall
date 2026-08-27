/**
 * What each plan offers, in the words a person reading a paywall needs.
 *
 * The numbers here are copy, not enforcement -- the server decides what is
 * allowed (backend/kall/services/quota.py) and this only describes it. They
 * are duplicated deliberately rather than fetched, so a paywall can render
 * instantly at the moment someone is blocked; if they ever disagree, the
 * server is right.
 */

export type PlanId = 'free' | 'plus' | 'premium';

export type Plan = {
  id: PlanId;
  name: string;
  price: string;
  cadence: string;
  pitch: string;
  lines: string[];
};

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    cadence: '',
    pitch: 'Enough to know whether Kall works for you.',
    lines: [
      '5 applications a week',
      '3 AI actions a week',
      '25 MB of resumes',
      'Job search, tracking and tailoring',
    ],
  },
  {
    id: 'plus',
    name: 'Plus',
    price: '$5',
    cadence: '/month',
    pitch: 'For a real search, run weekly.',
    lines: [
      '25 applications a week',
      '15 AI actions a week',
      '500 MB of resumes',
      'Daily brief and scheduled discovery',
      'Career page without the Kall footer',
      'The apply extension',
    ],
  },
  {
    id: 'premium',
    name: 'Premium',
    price: '$15',
    cadence: '/month',
    pitch: 'For a search you are not counting.',
    lines: [
      'Unlimited applications',
      '400 AI actions a month',
      '5 GB of resumes',
      'A career page per role',
      'Custom domain',
      'Everything in Plus',
    ],
  },
];

/** Human wording for a meter named by the API. */
export const METER_LABELS: Record<string, string> = {
  applications: 'applications',
  ai_actions: 'AI actions',
  storage_bytes: 'resume storage',
};

/** The plan above this one, or null at the top. */
export function nextPlanAfter(plan: string): Plan | null {
  const order: PlanId[] = ['free', 'plus', 'premium'];
  const index = order.indexOf(plan as PlanId);
  if (index < 0 || index >= order.length - 1) return null;
  return PLANS.find((entry) => entry.id === order[index + 1]) ?? null;
}

/**
 * When a weekly allowance comes back.
 *
 * Periods are ISO weeks on the server, so the refill is the next Monday at
 * 00:00 UTC. Naming the day is more use than "in 3 days" when someone is
 * deciding whether to wait or to pay.
 *
 * Rendered in UTC deliberately. The boundary is a UTC instant, and formatting
 * it in the reader's own zone showed "Sunday" to anyone west of Greenwich --
 * a refill date that contradicts the Monday-to-Sunday week it belongs to.
 * Someone in UTC-5 will see their allowance return on Sunday evening local
 * time, which is a smaller surprise than being told the wrong weekday.
 */
export function refillsOn(period: string): string {
  if (period === 'week') {
    const now = new Date();
    const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
    const next = new Date(now);
    next.setUTCDate(now.getUTCDate() + daysUntilMonday);
    next.setUTCHours(0, 0, 0, 0);
    return next.toLocaleDateString(undefined, {
      weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC',
    });
  }
  if (period === 'month') {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return next.toLocaleDateString(undefined, { month: 'long', day: 'numeric', timeZone: 'UTC' });
  }
  return '';
}
