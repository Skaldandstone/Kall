// Browser-side Sentry bootstrap. Next.js loads this before any client code
// runs. The DSN is read from a <meta> tag the root layout renders from the
// web service's SENTRY_DSN at request time - see lib/sentry-shared.ts for
// why it is not inlined at build. Inert when the tag is absent or empty.
import * as Sentry from '@sentry/nextjs';
import {
  SENTRY_DSN_META_NAME,
  SENTRY_ENVIRONMENT_META_NAME,
  sharedSentryOptions,
} from './lib/sentry-shared';

function readMeta(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const content = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content;
  return content ? content : undefined;
}

const dsn = readMeta(SENTRY_DSN_META_NAME);
if (dsn) {
  Sentry.init({
    ...sharedSentryOptions,
    dsn,
    environment: readMeta(SENTRY_ENVIRONMENT_META_NAME) ?? 'production',
    // No session replay: it records the screen, and the screen shows the
    // profile fields this app exists to protect.
    integrations: [],
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
