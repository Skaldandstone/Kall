// Server-side Sentry bootstrap. Next.js calls register() once per runtime
// (Node for route handlers and server components, edge for middleware)
// before any application code runs. Inert when SENTRY_DSN is unset.
import * as Sentry from '@sentry/nextjs';
import { sharedSentryOptions } from './lib/sentry-shared';

export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    ...sharedSentryOptions,
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    // The image is immutable and its digest is what CloudFormation deploys,
    // so the package version is the most honest release label available at
    // runtime without a build argument.
    release: `kall-web@${process.env.npm_package_version ?? 'unknown'}`,
  });
}

// Errors thrown in server components, route handlers and server actions
// reach Sentry through this hook, so the /api/kall/* proxy is covered
// without wrapping each handler.
export const onRequestError = Sentry.captureRequestError;
