// Shared Sentry options for the browser, Node and edge runtimes.
//
// Kall's web app handles EEO and work-authorization data, so the default SDK
// behaviour is narrowed before anything leaves the process: no request
// bodies, headers or cookies, no user identity, no breadcrumbs, no session
// replay and no performance tracing. An error report carries the exception,
// the stack and the route - enough to fix a bug, nothing that says whose
// request it was.
//
// The DSN itself is public by design (it can only *send* events to one
// project), which is why it travels as a plain environment variable and, on
// the client, as a <meta> tag rendered by the root layout at request time.
// That keeps it out of the image build entirely: no NEXT_PUBLIC_ inlining, no
// new build argument for the fail-closed CodeBuild job, and a DSN change is a
// task-definition change rather than an image rebuild.
import type { ErrorEvent } from '@sentry/nextjs';

export const SENTRY_DSN_META_NAME = 'kall-sentry-dsn';
export const SENTRY_ENVIRONMENT_META_NAME = 'kall-sentry-environment';

/** Strip anything that could identify a person from an outgoing event. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  delete event.breadcrumbs;
  if (event.request) {
    // The full URL may carry a slug or token in the path (career pages,
    // invitation links). The method plus the route on the transaction is
    // enough to find the failing handler.
    const { method } = event.request;
    event.request = method ? { method } : {};
  }
  return event;
}

/** Options every runtime shares; each runtime supplies its own dsn/environment. */
export const sharedSentryOptions = {
  sendDefaultPii: false,
  tracesSampleRate: 0,
  // Never keep breadcrumbs: console lines, fetch URLs and navigation
  // history are all channels for a name or an email to ride along.
  maxBreadcrumbs: 0,
  beforeBreadcrumb: () => null,
  beforeSend: scrubEvent,
  // Sentry's own debug output stays off even when a DSN is present.
  debug: false,
} as const;
