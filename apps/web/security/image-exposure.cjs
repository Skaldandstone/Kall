// Production HTTP regression; no Clerk setup, credentials or external image fetches.
// Build first, then: node security/image-exposure.cjs
// Historical comparison only: node security/image-exposure.cjs baseline
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const app = path.resolve(__dirname, '..');
const baseline = process.argv[2] === 'baseline';
assert(process.argv.length === 2 || baseline, 'Only the explicit baseline argument is supported');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function main() {
  // Next loads .env files automatically; refuse them, even if the shell is clean.
  for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    assert(!fs.existsSync(path.join(app, name)), `Refusing local HTTP test with ${name} present`);
  }
  const built = JSON.parse(fs.readFileSync(path.join(app, '.next/required-server-files.json')));
  assert.equal(built.config.images.unoptimized, !baseline, 'Rebuild after changing image policy');
  assert.equal(built.config.images.disableStaticImages, !baseline);
  const { pathToFileURL } = require('node:url');
  const source = (await import(pathToFileURL(path.join(app, 'next.config.mjs')).href)).default;
  assert.equal(source.images?.unoptimized ?? false, !baseline, 'Source image policy must match the test mode');
  assert.equal(source.images?.disableStaticImages ?? false, !baseline);
  let backendRequests = 0;
  const backend = http.createServer((_req, res) => {
    backendRequests++;
    res.writeHead(500).end('Unexpected synthetic backend request');
  });
  const backendPort = await listen(backend);
  const reservation = http.createServer();
  const port = await listen(reservation);
  await new Promise((resolve) => reservation.close(resolve));
  const env = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, {
    NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', CLERK_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_a2FsbC1sb2NhbC1maXh0dXJlLmNsZXJrLmFjY291bnRzLmRldiQ=',
    KALL_API_URL: `http://127.0.0.1:${backendPort}`, STRIPE_ENABLED: 'false',
  });
  const child = spawn(process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)],
    { cwd: app, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let logs = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${logs}`)), 30_000);
    const capture = (data) => {
      logs = (logs + data).slice(-8000);
      if (logs.includes('Ready in')) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`Server exited: ${logs}`)); });
  });
  const checks = [];
  async function get(url) {
    return fetch(`http://127.0.0.1:${port}${url}`, {
      redirect: 'manual', signal: AbortSignal.timeout(15_000),
    });
  }
  try {
    await ready;
    for (const asset of [
      'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
      'icon-maskable-192.png', 'icon-maskable-512.png',
      'brand/kall-mark.svg', 'brand/kall-mark-on-light.svg', 'brand/kall-mark-mono.svg',
      'brand/kall-lockup.svg', 'brand/kall-icon-app.svg', 'manifest.webmanifest',
    ]) {
      const response = await get(`/${asset}`);
      assert.equal(response.status, 200, asset);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(path.join(app, 'public', asset)));
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      checks.push({ path: `/${asset}`, status: 200, originalBytes: true });
    }
    const queries = [
      ['?url=%2Ficon-192.png&w=64&q=75', baseline ? 200 : 404],
      [`?url=${encodeURIComponent(`http://127.0.0.1:${backendPort}/synthetic.png`)}&w=64&q=75`, baseline ? 400 : 404],
      ['', baseline ? 400 : 404],
    ];
    if (!baseline) queries.push(
      ['?url=%2Fapi%2Fkall%2Fme%2Fresumes&w=64&q=75', 404],
      ['?url=%2Fsynthetic.icns&w=64&q=75', 404],
      ['?url=%2Fsynthetic.jxl&w=64&q=75', 404],
    );
    for (const [query, expected] of queries) {
      const response = await get(`/_next/image${query}`);
      assert.equal(response.status, expected, query);
      await response.arrayBuffer();
      checks.push({ path: `/_next/image${query}`, status: response.status });
    }
    assert.equal(backendRequests, 0, 'Image requests must never fetch the synthetic backend');
    console.log(JSON.stringify({ mode: baseline ? 'historical-baseline' : 'mitigated',
      nextVersion: require('next/package.json').version, backendRequests, checks }, null, 2));
  } finally {
    child.kill(); // Only this harness's own direct Node process, never a process-name sweep.
    await exited;
    backend.closeAllConnections();
    await new Promise((resolve) => backend.close(resolve));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
