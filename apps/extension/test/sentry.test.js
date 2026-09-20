/**
 * sentry.js's two promises: without a DSN it never loads the SDK or touches
 * the network, and whatever it does send has been stripped of anything that
 * could name the person applying. The SDK itself is never imported here --
 * the no-DSN path is exactly the path that must not import it.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const { captureException, initSentry, resetSentryForTests, scrubEvent, sentryOptions, EXCLUDED_INTEGRATIONS } =
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
