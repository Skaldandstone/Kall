'use client';

import { useEffect, useRef, useState } from 'react';

type ToastKind = 'error' | 'success' | 'info';
type ToastDetail = { message: string; kind?: ToastKind; duration?: number };
type ToastItem = ToastDetail & { id: number };

declare global { interface WindowEventMap { 'kall:toast': CustomEvent<ToastDetail>; } }

export function showToast(message: string, kind: ToastKind = 'info', duration = 4200) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ToastDetail>('kall:toast', { detail: { message, kind, duration } }));
}

export default function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seen = useRef(new Map<string, number>());

  useEffect(() => {
    let nextId = 0;
    const inlineMessages = new WeakMap<HTMLElement, string>();
    const add = (detail: ToastDetail) => {
      const message = String(detail.message || '').trim();
      if (!message) return;
      const now = Date.now();
      if (now - (seen.current.get(message) || 0) < 1500) return;
      seen.current.set(message, now);
      const id = ++nextId;
      const duration = detail.duration ?? 4200;
      setToasts((current) => [...current.slice(-2), { ...detail, message, id }]);
      window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), duration);
    };
    const inspect = (root: ParentNode) => {
      root.querySelectorAll<HTMLElement>('[role="alert"], [data-toast-kind], .message').forEach((node) => {
        const message = node.textContent?.trim();
        if (!message || node.closest('.kall-toast-region') || node.id === '__next-route-announcer__') return;
        if (inlineMessages.get(node) === message) return;
        inlineMessages.set(node, message);
        const kind = (node.dataset.toastKind as ToastKind | undefined) || (node.getAttribute('role') === 'alert' ? 'error' : 'info');
        // Inline messages remain available after the toast expires. In
        // particular, never hide a retry button inside an alert.
        if (node.querySelector('button, a, input, select, textarea')) return;
        add({ message, kind });
      });
    };
    const onToast = (event: CustomEvent<ToastDetail>) => add(event.detail);
    const onError = (event: ErrorEvent) => add({ message: event.message || 'An unexpected error occurred.', kind: 'error' });
    const onRejection = (event: PromiseRejectionEvent) => add({ message: event.reason instanceof Error ? event.reason.message : 'An unexpected request error occurred.', kind: 'error' });
    const observer = new MutationObserver((records) => records.forEach((record) => {
      if (record.target instanceof HTMLElement) inspect(record.target.parentElement || document);
      record.addedNodes.forEach((node) => { if (node instanceof HTMLElement) inspect(node); });
    }));

    window.addEventListener('kall:toast', onToast);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    inspect(document);
    return () => {
      window.removeEventListener('kall:toast', onToast);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      observer.disconnect();
    };
  }, []);

  if (!toasts.length) return null;
  return <div className="kall-toast-region" role="region" aria-label="Notifications" aria-live="polite">{toasts.map((toast) => <div className={`kall-toast kall-toast-${toast.kind || 'info'}`} role={toast.kind === 'error' ? 'alert' : 'status'} key={toast.id}><span>{toast.message}</span><button type="button" aria-label="Dismiss notification" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}>×</button></div>)}</div>;
}
