import assert from 'node:assert/strict';
import { test } from 'node:test';

const oldTime = Date.now() - 2 * 60 * 60 * 1000;
const identity = (id, addresses, created_at = oldTime) => ({
  id,
  created_at,
  primary_email_address_id: `${id}-email-0`,
  email_addresses: addresses.map((email_address, index) => ({
    id: `${id}-email-${index}`, email_address,
  })),
});
const synthetic = (id) => identity(id, [`e2e-${id}+clerk_test@example.com`]);
const pageResponse = (users) => new Response(JSON.stringify(users), { status: 200 });

async function withFetch(replacement, run) {
  const original = globalThis.fetch;
  globalThis.fetch = replacement;
  try { await run(); } finally { globalThis.fetch = original; }
}

for (const app of ['web', 'mobile']) {
  const { purgeTestUsers, assertDevelopmentKeys } = await import(`../apps/${app}/e2e/purge-test-users.ts`);

  test(`${app}: ordinary runs never list or delete remote users`, async () => {
    await withFetch(() => assert.fail('Unexpected remote request'), async () => {
      assert.equal(await purgeTestUsers('sk_test_fixture'), 0);
      assert.equal(await purgeTestUsers('sk_test_fixture', { enabled: false }), 0);
    });
  });

  test(`${app}: explicit cleanup refuses production keys before any request`, async () => {
    await withFetch(() => assert.fail('Unexpected remote request'), async () => {
      await assert.rejects(purgeTestUsers('sk_live_sensitive_value', { enabled: true }), (error) => {
        assert.match(error.message, /Production keys are refused/);
        assert.ok(!error.message.includes('sensitive_value'));
        return true;
      });
    });
  });

  test(`${app}: configuration rejects mixed or invalid development keys`, () => {
    assert.doesNotThrow(() => assertDevelopmentKeys('sk_test_fixture', 'pk_test_fixture'));
    assert.throws(() => assertDevelopmentKeys('sk_test_fixture', 'pk_live_fixture'));
    assert.throws(() => assertDevelopmentKeys('sk_live_fixture', 'pk_test_fixture'));
    assert.throws(() => assertDevelopmentKeys('', 'pk_test_fixture'));
    assert.throws(() => assertDevelopmentKeys('sk_test_fixture', ''));
  });

  test(`${app}: only old identities containing exclusively recognized test addresses are collected`, async () => {
    const users = [
      synthetic('old'),
      identity('mobile', ['mobile-smoke-old+clerk_test@example.com']),
      identity('recent', ['e2e-recent+clerk_test@example.com'], Date.now()),
      identity('real', ['person@example.com']),
      identity('mixed', ['person@example.com', 'e2e-secondary+clerk_test@example.com']),
      identity('mixed-primary', ['e2e-primary+clerk_test@example.com', 'person@example.com']),
      identity('wrong-domain', ['e2e-old+clerk_test@company.example']),
      identity('no-emails', []),
      { ...synthetic('no-primary'), primary_email_address_id: null },
      { ...synthetic('bad-time'), created_at: null },
      { ...synthetic('future'), created_at: Date.now() + 100000 },
    ];
    const deleted = [];
    await withFetch(async (url, options) => {
      if (options.method === 'DELETE') {
        deleted.push(String(url).split('/').at(-1));
        return new Response(null, { status: 204 });
      }
      return pageResponse(users);
    }, async () => {
      assert.equal(await purgeTestUsers('sk_test_fixture', { enabled: true }), 2);
      assert.deepEqual(deleted, ['old', 'mobile']);
    });
  });

  test(`${app}: listing finishes before deletion so pagination cannot skip shifted rows`, async () => {
    const first = Array.from({ length: 100 }, (_, index) => synthetic(`first-${index}`));
    const calls = [];
    await withFetch(async (url, options) => {
      if (options.method === 'DELETE') {
        calls.push('DELETE');
        return new Response(null, { status: 204 });
      }
      const offset = new URL(url).searchParams.get('offset');
      calls.push(`GET:${offset}`);
      return pageResponse(offset === '0' ? first : [synthetic('last')]);
    }, async () => {
      assert.equal(await purgeTestUsers('sk_test_fixture', { enabled: true }), 101);
      assert.deepEqual(calls.slice(0, 2), ['GET:0', 'GET:100']);
      assert.equal(calls.filter((call) => call === 'DELETE').length, 101);
    });
  });

  test(`${app}: a later listing failure never begins a partial destructive sweep`, async () => {
    await withFetch(async (url, options) => {
      assert.notEqual(options.method, 'DELETE');
      return new URL(url).searchParams.get('offset') === '0'
        ? pageResponse(Array.from({ length: 100 }, (_, index) => synthetic(`test-${index}`)))
        : new Response('private provider response', { status: 403 });
    }, async () => {
      await assert.rejects(purgeTestUsers('sk_test_fixture', { enabled: true }), /HTTP 403$/);
    });
  });

  test(`${app}: failed deletion is reported, not silently counted as success`, async () => {
    await withFetch(async (_url, options) => options.method === 'DELETE'
      ? new Response('private provider response', { status: 403 })
      : pageResponse([synthetic('old')]), async () => {
      await assert.rejects(purgeTestUsers('sk_test_fixture', { enabled: true }), /HTTP 403$/);
    });
  });

  test(`${app}: an already removed fixture is a successful cleanup outcome`, async () => {
    await withFetch(async (_url, options) => options.method === 'DELETE'
      ? new Response(null, { status: 404 })
      : pageResponse([synthetic('old')]), async () => {
      assert.equal(await purgeTestUsers('sk_test_fixture', { enabled: true }), 1);
    });
  });
}
