'use client';

import { useEffect, useState } from 'react';

const API = '/api/kall';

type EmailEvent = {
  id: number;
  application_id: number | null;
  event_type: 'confirmation' | 'interview' | 'rejection' | 'other';
  evidence: { sender?: string; subject?: string; snippet?: string; url?: string | null; company_name_guess?: string | null };
};

type CareerProfile = { id: number; name: string };

const LABEL: Record<EmailEvent['event_type'], string> = {
  confirmation: 'application confirmed',
  interview: 'an interview',
  rejection: 'a rejection',
  other: 'a status update',
};

/** A confirm/reject banner for detected email events, matching the same
 * accept/reject pairing DocumentsReviewPanel.tsx and the "Did you apply?"
 * prompt already use elsewhere -- nothing here writes anything until the
 * person taps a button. A matched event confirms in place; an unmatched
 * confirmation email (nothing in the pipeline matches it) offers to import
 * it as a new application instead -- the plan's "help outside applications
 * live in Kall too" bonus capability. */
export default function EmailEventBanner({ onChanged }: { onChanged?: () => void }) {
  const [events, setEvents] = useState<EmailEvent[]>([]);
  const [profiles, setProfiles] = useState<CareerProfile[]>([]);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${API}/me/email-events`)
      .then((response) => (response.ok ? response.json() : []))
      .then((data: EmailEvent[]) => setEvents(data))
      .catch(() => undefined);
    fetch(`${API}/me/career-profiles`)
      .then((response) => (response.ok ? response.json() : []))
      .then(setProfiles)
      .catch(() => undefined);
  }, []);

  async function respond(event: EmailEvent, action: 'confirm' | 'dismiss') {
    setBusy(event.id);
    try {
      const response = await fetch(`${API}/me/email-events/${event.id}/${action}`, {
        method: 'POST',
        headers: action === 'confirm' ? { 'Content-Type': 'application/json' } : undefined,
        body: action === 'confirm' ? JSON.stringify({}) : undefined,
      });
      if (response.ok) {
        setEvents((current) => current.filter((item) => item.id !== event.id));
        onChanged?.();
      }
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(event: EmailEvent) {
    setBusy(event.id);
    try {
      const response = await fetch(`${API}/me/email-events/${event.id}/dismiss`, { method: 'POST' });
      if (response.ok) setEvents((current) => current.filter((item) => item.id !== event.id));
    } finally {
      setBusy(null);
    }
  }

  async function importAsApplication(event: EmailEvent) {
    if (profiles.length === 0) return;
    setBusy(event.id);
    try {
      const response = await fetch(`${API}/me/email-events/${event.id}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ professional_profile_id: profiles[0].id }),
      });
      if (response.ok) {
        setEvents((current) => current.filter((item) => item.id !== event.id));
        onChanged?.();
      }
    } finally {
      setBusy(null);
    }
  }

  if (events.length === 0) return null;

  return (
    <div className="stack" style={{ marginBottom: 16 }}>
      {events.map((event) => {
        const unmatched = event.application_id === null;
        const canImport = unmatched && event.event_type === 'confirmation' && Boolean(event.evidence.url);
        return (
          <article className="card" key={event.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <span>
              {unmatched
                ? `An email${event.evidence.company_name_guess ? ` from ${event.evidence.company_name_guess}` : ''} looks like an application you made outside Kall`
                : `We think this was ${LABEL[event.event_type]}`}
              {event.evidence.subject ? ` ("${event.evidence.subject}")` : ''}.
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              {unmatched ? (
                <>
                  {canImport && (
                    <button className="button" disabled={busy === event.id || profiles.length === 0} onClick={() => void importAsApplication(event)}>
                      Add to my pipeline
                    </button>
                  )}
                  <button className="button ghost" disabled={busy === event.id} onClick={() => void dismiss(event)}>Not this one</button>
                </>
              ) : (
                <>
                  <button className="button" disabled={busy === event.id} onClick={() => void respond(event, 'confirm')}>Confirm</button>
                  <button className="button ghost" disabled={busy === event.id} onClick={() => void respond(event, 'dismiss')}>Not this one</button>
                </>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
