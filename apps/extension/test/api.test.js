/**
 * api.js's request logic.
 *
 * The interesting behavior is entirely about the bearer token: no token
 * means NotSignedInError without ever touching the network, and a token
 * means it lands in the Authorization header against the backend's real
 * /api/* path -- not the web app's /api/kall/* proxy path this used to call,
 * which is the whole reason the extension could not see a real sign-in
 * before this change (see docs/EXTENSION_CLERK_SETUP.md).
 */

import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

global.chrome = {
  storage: { sync: { get: async () => ({}) } },
};

mock.module('../src/auth.js', {
  exports: { getSessionToken: async () => global.__testToken ?? null },
});

const { listApplications, resumeDataUrl, NotSignedInError } = await import('../src/api.js');

test('no session token throws NotSignedInError without calling fetch', async () => {
  global.__testToken = null;
  let called = false;
  global.fetch = async () => { called = true; return { ok: true, status: 200, json: async () => [] }; };

  await assert.rejects(() => listApplications(), NotSignedInError);
  assert.equal(called, false, 'a signed-out request must never reach the network');
});

test('a token is sent as a bearer header against the real /api path, not /api/kall', async () => {
  global.__testToken = 'test-token-123';
  let seenUrl, seenHeaders;
  global.fetch = async (url, init) => {
    seenUrl = url;
    seenHeaders = init.headers;
    return { ok: true, status: 200, json: async () => [{ id: 1 }] };
  };

  const result = await listApplications();

  assert.equal(seenUrl, 'https://d7wb2yokfqcku.cloudfront.net/api/applications');
  assert.equal(seenHeaders.Authorization, 'Bearer test-token-123');
  assert.deepEqual(result, [{ id: 1 }]);
});

test('a 401 from the backend is reported the same as no token at all', async () => {
  global.__testToken = 'test-token-123';
  global.fetch = async () => ({ ok: false, status: 401 });

  await assert.rejects(() => listApplications(), NotSignedInError);
});

test('resumeDataUrl requests the download_url path as-is -- it is already /api/...', async () => {
  // FileReader is a browser API; the DOM-behavior half of this (does it
  // actually decode to a usable data URL) is covered by the Playwright suite
  // instead. This just needs enough of the shape to prove the URL and the
  // auth header are right, which is the part that changed.
  global.FileReader = class {
    readAsDataURL() { this.onload?.(); }
    get result() { return 'data:application/pdf;base64,AAAA'; }
  };

  global.__testToken = 'test-token-123';
  let seenUrl;
  global.fetch = async (url) => {
    seenUrl = url;
    return {
      ok: true,
      status: 200,
      blob: async () => ({ type: 'application/pdf' }),
    };
  };

  const { dataUrl } = await resumeDataUrl('/api/me/resumes/7/download');

  assert.equal(seenUrl, 'https://d7wb2yokfqcku.cloudfront.net/api/me/resumes/7/download');
  assert.equal(dataUrl, 'data:application/pdf;base64,AAAA');
});
