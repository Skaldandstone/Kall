'use client';

import { useEffect, useState } from 'react';

type Props = {
  /** What is being looked through, e.g. "matching job sources". */
  heading: string;
  /** One sentence on what Kall is doing with the person's own criteria. */
  detail: string;
  /**
   * Seconds the same kind of run has actually taken for this account, when
   * there is history to measure. A number invented for the copy would be
   * worse than the range, so this stays null until a real run has finished.
   */
  estimateSeconds?: number | null;
};

function estimateSentence(estimateSeconds: number | null | undefined) {
  if (!estimateSeconds || estimateSeconds <= 0) {
    return 'This usually takes 10 to 30 seconds.';
  }
  if (estimateSeconds < 60) {
    const rounded = Math.max(5, Math.round(estimateSeconds / 5) * 5);
    return `Your recent searches have taken about ${rounded} seconds.`;
  }
  const minutes = Math.round(estimateSeconds / 30) / 2;
  return `Your recent searches have taken about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

/**
 * The state a running search is actually in, in place of the empty state it
 * has not left yet.
 *
 * Search already did this; discovery and consulting changed a status line
 * and left "No matching results yet -- run Search Now" on screen for the
 * whole run, which reads as a search that did nothing.
 */
export default function SearchProgress({ heading, detail, estimateSeconds }: Props) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const target = estimateSeconds && estimateSeconds > 0 ? estimateSeconds : 30;
  // Approaches the estimate without ever claiming to have reached it: a bar
  // sitting at 100% while the request is still open is a lie about state.
  const percent = Math.min(95, Math.round((elapsed / target) * 100));

  return (
    <div className="search-empty-state search-progress">
      {/* Announced once. The seconds tick every second and would otherwise
          interrupt a screen reader continuously for the whole run. */}
      <div role="status" aria-live="polite">
        <span className="pill">Search running</span>
        <h2>{heading}</h2>
        <p>{estimateSentence(estimateSeconds)} {detail}</p>
      </div>
      <div className="search-progress-track" aria-hidden="true">
        <div className="search-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="muted" aria-hidden="true">{elapsed}s elapsed</p>
    </div>
  );
}
