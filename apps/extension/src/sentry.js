/**
 * Error reporting for the popup, with the same privacy stance as the web
 * app's apps/web/lib/sentry-shared.ts: Kall handles EEO and
 * work-authorization data, so nothing that could say whose popup this was
 * ever leaves the extension. No user identity, no breadcrumbs, no request
 * URLs (a job-board page URL can identify the person applying), no session
 * replay, no performance tracing. An event carries the exception, the stack,
 * the extension version and the environment -- enough to fix a bug.
 *
 * The client is built by hand (BrowserClient + Scope) rather than through
 * Sentry.init(), as Sentry's own browser-extension guidance asks:
 * https://docs.sentry.io/platforms/javascript/best-practices/browser-extensions/
 * Sentry.init() installs a global hub, and an extension sharing global
 * state with a host page can send the page's errors to Kall's project or
 * Kall's errors to the page's. The popup is its own chrome-extension://
 * document, so the risk is small here, but the isolated pattern costs
 * nothing and stays correct if this module is ever loaded anywhere else.
 * content.js is deliberately NOT instrumented: it runs inside the employer's
 * page, exactly where that pollution would happen.
 *
 * The DSN arrives at build time: esbuild.config.mjs defines __SENTRY_DSN__
 * from the SENTRY_DSN environment variable (a DSN is public by design -- it
 * can only send events to one project). With no DSN, initSentry() resolves
 * to null before the dynamic import() below runs, so the SDK is never
 * initialized and no event is ever built or sent: local builds, CI and the
 * unit tests never touch the network. (esbuild inlines the dynamic import,
 * so the SDK's code is still present in every popup.bundle.js -- it just
 * never executes without a DSN.)
 */

/* global __SENTRY_DSN__, __SENTRY_ENVIRONMENT__ */

// esbuild replaces these identifiers with string literals; under Node (the
// unit tests import this file unbundled) they are simply undefined.
const BUILD_DSN = typeof __SENTRY_DSN__ === 'string' ? __SENTRY_DSN__ : '';
const BUILD_ENVIRONMENT = typeof __SENTRY_ENVIRONMENT__ === 'string' ? __SENTRY_ENVIRONMENT__ : '';

/**
 * Integrations that keep global state or record activity we do not want:
 * the same list Sentry's extension guidance filters, plus nothing that
 * would reintroduce breadcrumbs. Named here so the unit test can assert on
 * the policy rather than on Sentry internals.
 */
export const EXCLUDED_INTEGRATIONS = [
  'BrowserApiErrors',
  'BrowserSession',
  'Breadcrumbs',
  'ConversationId',
  'GlobalHandlers',
  'FunctionToString',
  // Locale + timezone: a weak fingerprint, and nothing a stack trace needs.
  'CultureContext',
];

export const IGNORED_ERRORS = [
  // The popup closed (or the tab navigated) before a chrome.* call
  // finished. Expected whenever someone clicks away mid-fill; not a bug.
  'The message port closed before a response was received',
  'Extension context invalidated',
  'Receiving end does not exist',
  // Someone fully signed out between opening the popup and clicking.
  'Sign in to Kall, then try again.',
];

/**
 * URL-shaped substrings inside error text. Chrome itself writes the active
 * tab's URL into some of its own error messages -- for example
 * chrome.scripting.executeScript rejects with
 *   Cannot access contents of url "https://<full tab URL>". Extension
 *   manifest must request permission to access this host.
 * whenever the tab is a page activeTab cannot reach, and that URL is the
 * job posting the person is applying to. Matches bare and quoted URLs on
 * the web, extension and file schemes; the replacement keeps the sentence
 * readable in Sentry.
 */
const URL_PATTERN = /(?:https?|file|chrome(?:-extension)?):\/\/[^\s"'`<>]*[^\s"'`<>.,;:!?)]/g;
const URL_PLACEHOLDER = '<url>';

/** Replace every URL in a string with the placeholder; non-strings pass through. */
export function redactUrls(text) {
  return typeof text === 'string' ? text.replace(URL_PATTERN, URL_PLACEHOLDER) : text;
}

/** Strip anything that could identify a person from an outgoing event. */
export function scrubEvent(event) {
  delete event.user;
  delete event.breadcrumbs;
  if (typeof event.message === 'string') {
    event.message = redactUrls(event.message);
  }
  // exception.values holds the whole cause chain (LinkedErrors stays
  // enabled), so every value is scrubbed, not just the outermost one.
  for (const value of event.exception?.values ?? []) {
    if (value && typeof value.value === 'string') value.value = redactUrls(value.value);
  }
  if (event.request) {
    // The popup's own URL is a fixed chrome-extension:// path and says
    // nothing useful, but the SDK may also pick up the active tab's URL
    // from a stack frame -- and a job posting URL can name the applicant.
    const { method } = event.request;
    event.request = method ? { method } : {};
  }
  return event;
}

/** Options shared with the web app, translated to @sentry/browser. */
export function sentryOptions({ dsn, environment, release }) {
  return {
    dsn,
    environment,
    release,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    beforeSend: scrubEvent,
    debug: false,
    ignoreErrors: IGNORED_ERRORS,
  };
}

let ready = null;

/**
 * Build the isolated client. Returns a promise of the Scope (or null when
 * there is no DSN). Idempotent: the popup calls this once at startup and
 * captureException() below waits on the same promise.
 */
export function initSentry({ dsn = BUILD_DSN, environment = BUILD_ENVIRONMENT || 'production' } = {}) {
  if (ready) return ready;
  if (!dsn) {
    ready = Promise.resolve(null);
    return ready;
  }
  ready = (async () => {
    const Sentry = await import('@sentry/browser');
    const version = globalThis.chrome?.runtime?.getManifest?.()?.version;
    const client = new Sentry.BrowserClient({
      ...sentryOptions({ dsn, environment, release: version ? `kall-extension@${version}` : undefined }),
      transport: Sentry.makeFetchTransport,
      stackParser: Sentry.defaultStackParser,
      integrations: Sentry.getDefaultIntegrations({}).filter(
        (integration) => !EXCLUDED_INTEGRATIONS.includes(integration.name),
      ),
    });
    const scope = new Sentry.Scope();
    scope.setClient(client);
    client.init();

    // GlobalHandlers is excluded above because it hooks window globally.
    // The popup window is entirely ours, so the two listeners it would have
    // added are added here explicitly, on this document only.
    if (typeof window !== 'undefined') {
      window.addEventListener('error', (event) => {
        scope.captureException(event.error ?? new Error(String(event.message)));
      });
      window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        scope.captureException(reason instanceof Error ? reason : new Error(String(reason)));
      });
    }
    return scope;
  })().catch(() => null); // Sentry failing to load must never break the popup.
  return ready;
}

/**
 * Report a handled error. A no-op without a DSN, and never throws -- the
 * popup's own error rendering always wins over reporting it.
 */
export function captureException(error, extra = undefined) {
  if (!ready) return;
  void ready.then((scope) => {
    if (!scope) return;
    scope.captureException(error, extra ? { extra } : undefined);
  }).catch(() => {});
}

/** For tests: forget the client so initSentry() can be exercised again. */
export function resetSentryForTests() {
  ready = null;
}
