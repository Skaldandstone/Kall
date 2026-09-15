'use client';

import { useEffect, useState } from 'react';

const API = '/api/kall';

type EmailEvent = {
  id: number;
  application_id: number | null;
  event_type: 'confirmation' | 'interview' | 'rejection' | 'other';
  evidence: { sender?: string; subject?: string; snippet?: string };
};

const LABEL: Record<EmailEvent['event_type'], string> = {
  confirmation: 'application confirmed',
  interview: 'an interview',
  rejection: 'a rejection',
  other: 'a status update',
};

/** A confirm/reject banner for detected email events, matching the same
 * accept/reject pairing DocumentsReviewPanel.tsx and the "Did you apply?"
 * prompt already use elsewhere -- nothing here writes anything until the
 * person taps Confirm. Matched events confirm in place; an unmatched one
 * (matches nothing in the pipeline) is skipped here since it needs to be
 * linked to a specific application first. */
export default function EmailEventBanner({ onChanged }: { onChanged?: () => void }) {
  const [events, setEvents] = useState<EmailEvent[]>([]);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${API}/me/email-events`)
      .then((response) => (response.ok ? response.json() : []))
      .then((data: EmailEvent[]) => setEvents(data.filter((event) => event.application_id !== null)))
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

  if (events.length === 0) return null;

  return (
    <div className="stack" style={{ marginBottom: 16 }}>
      {events.map((event) => (
        <article className="card" key={event.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span>
            We think this was {LABEL[event.event_type]} — from an email
            {event.evidence.subject ? ` ("${event.evidence.subject}")` : ''}.
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button" disabled={busy === event.id} onClick={() => void respond(event, 'confirm')}>Confirm</button>
            <button className="button ghost" disabled={busy === event.id} onClick={() => void respond(event, 'dismiss')}>Not this one</button>
          </div>
        </article>
      ))}
    </div>
  );
}
