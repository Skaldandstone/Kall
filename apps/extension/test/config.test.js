import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

let storedOrigin;

global.chrome = {
  storage: {
    sync: {
      async get() {
        return storedOrigin ? { origin: storedOrigin } : {};
      },
    },
  },
};

const { origin } = await import('../src/config.js');

test('the packaged extension defaults to the production Kall origin', async () => {
  storedOrigin = undefined;
  assert.equal(await origin(), 'https://kall.skaldandstone.com');

  const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url)));
  assert.ok(manifest.host_permissions.includes('https://kall.skaldandstone.com/*'));
  assert.ok(!manifest.host_permissions.some((permission) => permission.includes('cloudfront.net')));
});

test('a locally configured origin still overrides the production default', async () => {
  storedOrigin = 'https://example.test';
  assert.equal(await origin(), storedOrigin);
});
