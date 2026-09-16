import { showPlanLimit, type PlanLimitDetail } from '../components/PlanLimitDialog';

const API = '/api/kall';

/**
 * The one place that knows what a plan refusal looks like.
 *
 * Every quota check in the backend returns 402 with a structured detail, and
 * this turns that into the paywall dialog. Doing it here rather than at each
 * call site means a new metered endpoint gets the behaviour for free, and no
 * screen has to remember to handle it.
 *
 * Returns the Response either way, so callers keep whatever error handling
 * they already had -- this adds the dialog, it does not take over.
 *
 * Gateway errors (502/503/504, or the fetch itself failing) are handled one
 * level down instead, by a window.fetch patch in MaintenanceBanner -- most
 * of the app calls the API with a plain fetch(`${API}...`), not this
 * function, so catching a mid-deploy gap here alone would miss most of it.
 */
export async function fetchKall(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${API}${path}`, init);

  if (response.status === 401) {
    window.location.replace('/sign-in');
    return response;
  }

  if (response.status === 402) {
    // Read from a clone: the caller still needs an unconsumed body.
    try {
      const body = await response.clone().json();
      const detail = body?.detail;
      if (detail?.code === 'plan_limit_reached' || detail?.code === 'plan_required') {
        showPlanLimit(detail as PlanLimitDetail);
      }
    } catch {
      // A 402 without the expected shape is still the caller's to report.
    }
  }

  return response;
}

/** GET returning parsed JSON, or null when the request was refused. */
export async function getKall<T>(path: string): Promise<T | null> {
  const response = await fetchKall(path);
  return response.ok ? ((await response.json()) as T) : null;
}
