// Browser-side Sentry bootstrap. Next.js loads this before any client code
// runs. The DSN comes from NEXT_PUBLIC_SENTRY_DSN, inlined at `next build`
// through the image build argument, with the root layout's request-time
// <meta> tag as a fallback for dynamically rendered pages. The build-time
// value is required because the marketing pages are prerendered: their HTML is
// frozen at build, so a tag rendered from the running task's environment never
// reaches them. Inert when neither source provides a DSN.
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

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || readMeta(SENTRY_DSN_META_NAME);
if (dsn) {
  Sentry.init({
    ...sharedSentryOptions,
    dsn,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? readMeta(SENTRY_ENVIRONMENT_META_NAME) ?? 'production',
    // No session replay: it records the screen, and the screen shows the
    // profile fields this app exists to protect.
    integrations: [],
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
