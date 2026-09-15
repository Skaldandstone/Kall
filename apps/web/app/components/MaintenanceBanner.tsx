'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './MaintenanceBanner.module.css';

/**
 * A tongue-in-cheek stand-in for a raw gateway error while a deploy rolls
 * out underneath someone's open tab.
 *
 * Mounted once in the root layout, driven by window events the same shape
 * as PlanLimitDialog. Unlike that dialog, the event here is dispatched from
 * a one-time window.fetch patch below rather than from lib/api.ts's
 * fetchKall -- most screens call the API with a plain fetch(`${API}...`),
 * not fetchKall, so hooking only fetchKall would miss most of the app.
 * Patching fetch itself catches every call to /api/kall uniformly, no
 * matter which of the two ever gets used at a given call site.
 */

declare global {
  interface WindowEventMap {
    'kall:maintenance': CustomEvent<void>;
    'kall:maintenance-clear': CustomEvent<void>;
  }
}

export function showMaintenance() {
  window.dispatchEvent(new CustomEvent<void>('kall:maintenance'));
}

export function clearMaintenance() {
  window.dispatchEvent(new CustomEvent<void>('kall:maintenance-clear'));
}

//: A gateway error (no healthy target behind the ALB yet) or the fetch
//: itself throwing (the API container mid-restart, connection refused) both
//: mean the same thing to someone with a tab open right now -- not
//: "something is broken", just "give it a moment". Anything else reaching
//: this point means the origin answered, so a deploy (if there was one) has
//: finished.
const GATEWAY_STATUSES = new Set([502, 503, 504]);
let patched = false;

function patchFetchOnce() {
  if (patched) return;
  patched = true;
  const original = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof URL ? args[0].href : args[0].url;
    if (!url.includes('/api/kall')) return original(...args);
    try {
      const response = await original(...args);
      if (GATEWAY_STATUSES.has(response.status)) showMaintenance();
      else clearMaintenance();
      return response;
    } catch (error) {
      showMaintenance();
      throw error;
    }
  };
}

export default function MaintenanceBanner() {
  const [visible, setVisible] = useState(false);
  const dismiss = useCallback(() => setVisible(false), []);

  useEffect(() => {
    patchFetchOnce();
    const onShow = () => setVisible(true);
    const onClear = () => setVisible(false);
    window.addEventListener('kall:maintenance', onShow);
    window.addEventListener('kall:maintenance-clear', onClear);
    return () => {
      window.removeEventListener('kall:maintenance', onShow);
      window.removeEventListener('kall:maintenance-clear', onClear);
    };
  }, []);

  if (!visible) return null;

  return (
    <div className={styles.banner} role="status">
      <span className={styles.rune} aria-hidden="true">ᛦ</span>
      <p>
        <strong>Kall is off consulting the runes for a moment.</strong> A new release is
        rolling out underneath you — this will sort itself out shortly, no action needed.
      </p>
      <button type="button" className={styles.dismiss} onClick={dismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
