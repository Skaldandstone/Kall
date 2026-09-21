/**
 * sentry.js's two promises: without a DSN it never initializes the SDK or
 * touches the network, and whatever it does send has been stripped of
 * anything that could name the person applying. The no-DSN tests never
 * import the SDK -- that path must not need it; the one test that does
 * import @sentry/browser only reads its integration names, never init().
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const { captureException, initSentry, redactUrls, resetSentryForTests, scrubEvent, sentryOptions, EXCLUDED_INTEGRATIONS } =
  await import('../src/sentry.js');

beforeEach(() => {
  resetSentryForTests();
});

test('with no DSN, init resolves to null and capture is a silent no-op', async () => {
  let fetched = false;
  global.fetch = async () => { fetched = true; return { ok: true, status: 200 }; };

  const scope = await initSentry({ dsn: '' });
  assert.equal(scope, null);

  captureException(new Error('boom'), { stage: 'test' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fetched, false, 'nothing may leave the extension without a DSN');
});

test('the unbundled module (no esbuild define) also defaults to no DSN', async () => {
  assert.equal(await initSentry(), null);
});

test('capture before init never throws', () => {
  assert.doesNotThrow(() => captureException(new Error('early')));
});

test('scrubEvent drops user, breadcrumbs and any request URL', () => {
  const event = scrubEvent({
    user: { id: 'user_123', email: 'someone@example.com' },
    breadcrumbs: [{ category: 'fetch', data: { url: 'https://jobs.example.com/apply/jane-doe' } }],
    request: { method: 'GET', url: 'https://jobs.example.com/apply/jane-doe', headers: { Cookie: 'x' } },
    exception: { values: [{ type: 'Error', value: 'boom' }] },
  });
  assert.equal(event.user, undefined);
  assert.equal(event.breadcrumbs, undefined);
  assert.deepEqual(event.request, { method: 'GET' });
  assert.deepEqual(event.exception, { values: [{ type: 'Error', value: 'boom' }] });
});

test('scrubEvent with no method leaves an empty request rather than a URL', () => {
  assert.deepEqual(scrubEvent({ request: { url: 'chrome-extension://abc/src/popup.html' } }).request, {});
});

test('the options mirror the web app: no PII, no tracing, no breadcrumbs', () => {
  const options = sentryOptions({ dsn: 'https://k@o1.ingest.us.sentry.io/1', environment: 'production', release: 'kall-extension@0.1.0' });
  assert.equal(options.sendDefaultPii, false);
  assert.equal(options.tracesSampleRate, 0);
  assert.equal(options.maxBreadcrumbs, 0);
  assert.equal(options.beforeBreadcrumb(), null);
  assert.equal(options.beforeSend, scrubEvent);
  assert.equal(options.debug, false);
  assert.equal(options.release, 'kall-extension@0.1.0');
  for (const name of ['Breadcrumbs', 'GlobalHandlers', 'BrowserSession']) {
    assert.ok(EXCLUDED_INTEGRATIONS.includes(name), `${name} must stay excluded`);
  }
});

test('scrubEvent redacts the tab URL Chrome writes into its own executeScript error', () => {
  // The exact shape chrome.scripting.executeScript rejects with when the
  // active tab is a page activeTab cannot reach. The applicant's job posting
  // URL is inside it, and LinkedErrors attaches the cause chain as extra
  // exception values, so every value must be scrubbed.
  const chromeMessage =
    'Cannot access contents of url "https://boards.greenhouse.io/acme/jobs/4012?gh_src=jane-doe". ' +
    'Extension manifest must request permission to access this host.';
  const event = scrubEvent({
    message: `send failed: ${chromeMessage}`,
    exception: {
      values: [
        { type: 'Error', value: chromeMessage },
        { type: 'Error', value: `Wrapped: ${chromeMessage} (see chrome-extension://abc/src/popup.html and file:///C:/Users/jane/resume.pdf)` },
      ],
    },
  });
  const expected =
    'Cannot access contents of url "<url>". Extension manifest must request permission to access this host.';
  assert.equal(event.exception.values[0].value, expected);
  assert.equal(event.exception.values[1].value, `Wrapped: ${expected} (see <url> and <url>)`);
  assert.equal(event.message, `send failed: ${expected}`);
  for (const text of [event.message, ...event.exception.values.map((v) => v.value)]) {
    assert.ok(!/greenhouse|jane|chrome-extension:|file:/.test(text), `URL survived scrubbing: ${text}`);
  }
});

test('redactUrls covers the schemes Chrome can put in a message and leaves other text alone', () => {
  assert.equal(redactUrls('at http://example.com/a?b=c#d end'), 'at <url> end');
  assert.equal(redactUrls("'https://x.test/p' and `chrome://extensions/` too"), "'<url>' and `<url>` too");
  assert.equal(redactUrls('Receiving end does not exist.'), 'Receiving end does not exist.');
  assert.equal(redactUrls(undefined), undefined);
  assert.deepEqual(scrubEvent({ exception: { values: [{ type: 'TypeError' }] } }).exception, { values: [{ type: 'TypeError' }] });
});

test('every excluded integration name matches one the SDK actually ships', async () => {
  // Filtering is by name, so a typo (or an upstream rename) would silently
  // re-enable the integration -- Breadcrumbs in particular. This is the
  // only test that imports the SDK; it never initializes a client.
  const { getDefaultIntegrations } = await import('@sentry/browser');
  const shipped = getDefaultIntegrations({}).map((integration) => integration.name);
  for (const name of EXCLUDED_INTEGRATIONS) {
    assert.ok(shipped.includes(name), `${name} is not a default @sentry/browser integration: ${shipped.join(', ')}`);
  }
  for (const name of ['CultureContext', 'Breadcrumbs']) {
    assert.ok(EXCLUDED_INTEGRATIONS.includes(name), `${name} must stay excluded`);
  }
});
