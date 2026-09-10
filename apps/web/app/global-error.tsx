'use client';

// Catches errors thrown in the root layout itself, which no nested
// error boundary can see. Reports to Sentry (a no-op when it is not
// initialised) and renders a minimal page - this replaces the whole
// document, so it cannot rely on the layout's fonts or providers.
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

//: A single-task ECS service briefly runs the old and new task during every
//: rolling deploy. A tab that loaded the old client bundle can POST a server
//: action ID the new task never registered -- clicking "Try again" would
//: just resubmit against the same still-loaded old bundle, so the only real
//: fix is a hard reload to fetch the current one. sentry-shared.ts's
//: ignoreErrors already keeps this out of Sentry as the known, expected
//: deploy-timing case it is.
const STALE_SERVER_ACTION = 'Failed to find Server Action';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isStaleServerAction = error.message?.includes(STALE_SERVER_ACTION);

  useEffect(() => {
    if (isStaleServerAction) {
      window.location.reload();
      return;
    }
    Sentry.captureException(error);
  }, [error, isStaleServerAction]);

  if (isStaleServerAction) {
    return null;
  }

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#191b1c',
          color: '#f2efe8',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <main style={{ maxWidth: '32rem', padding: '2rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>Something went wrong</h1>
          <p style={{ lineHeight: 1.5, marginBottom: '1.5rem' }}>
            Kall hit an error it could not recover from. It has been recorded. Your data is not
            affected - try again, and if it keeps happening, write to support@skaldandstone.com.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: '0.6rem 1.2rem',
              borderRadius: '0.5rem',
              border: '1px solid #f2efe8',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
