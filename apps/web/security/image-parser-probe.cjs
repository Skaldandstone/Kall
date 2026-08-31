// Opt-in diagnostic, never imported by Kall. Malformed inputs run only in workers.
// Run: node security/image-parser-probe.cjs
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');

function sample(format) {
  if (format === 'png') return fs.readFileSync(require.resolve('../public/icon-192.png'));
  if (format === 'icns') {
    const b = Buffer.alloc(16);
    b.write('icns');
    b.writeUInt32BE(b.length, 4);
    b.write('icp4', 8); // Zero-size entry: no forward progress in the vendored parser.
    return b;
  }
  const b = Buffer.alloc(32);
  Buffer.from('0000000c4a584c200d0a870a', 'hex').copy(b);
  b.writeUInt32BE(12, 12);
  b.write('ftyp', 16);
  b.write('jxl ', 20);
  b.write('jxlp', 28); // Zero-size partial codestream box.
  return b;
}

async function runWorker() {
  const { mode, format } = workerData;
  const input = sample(format);
  const parser = mode === 'parser'
    ? require('next/dist/compiled/image-size')
    : require('next/dist/server/image-optimizer');
  parentPort.postMessage({ stage: 'loaded', bytes: input.length });
  try {
    let result;
    if (mode === 'parser') result = parser(input);
    else if (mode === 'build-helper') result = await parser.getImageSize(input);
    else {
      const { imageConfigDefault } = require('next/dist/shared/lib/image-config');
      const optimized = await parser.imageOptimizer(
        { buffer: input, etag: 'synthetic', cacheControl: null },
        { href: '/synthetic', width: 64, quality: 75, mimeType: 'image/webp' },
        { images: imageConfigDefault, experimental: {} },
        { isDev: false, silent: true },
      );
      result = { contentType: optimized.contentType, unchanged: optimized.buffer.equals(input) };
    }
    parentPort.postMessage({ stage: 'returned', result });
  } catch (error) {
    parentPort.postMessage({ stage: 'rejected', error: error.name });
  }
}

async function probe(mode, format) {
  const started = performance.now();
  return new Promise((resolve) => {
    let loaded = false;
    let outcome = 'no-result';
    let result;
    const worker = new Worker(__filename, {
      workerData: { mode, format },
      resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 4, stackSizeMb: 2 },
    });
    const timeout = setTimeout(() => {
      outcome = 'watchdog-terminated';
      void worker.terminate();
    }, 10_000);
    worker.on('message', (message) => {
      if (message.stage === 'loaded') loaded = true;
      else { outcome = message.stage; result = message.result || message.error; }
    });
    worker.on('error', (error) => { outcome = error.code || error.name; });
    worker.on('exit', (code) => {
      clearTimeout(timeout);
      resolve({ mode, format, loaded, outcome, result, code,
        elapsedMs: Math.round(performance.now() - started) });
    });
  });
}

if (!isMainThread) {
  runWorker().catch(() => { process.exitCode = 1; });
} else {
  (async () => {
    const results = [];
    for (const mode of ['parser', 'build-helper']) {
      for (const format of ['png', 'icns', 'jxl']) results.push(await probe(mode, format));
    }
    for (const format of ['icns', 'jxl']) results.push(await probe('optimizer', format));
    console.log(JSON.stringify({
      nextVersion: require('next/package.json').version,
      parserSha256: crypto.createHash('sha256')
        .update(fs.readFileSync(require.resolve('next/dist/compiled/image-size'))).digest('hex'),
      oldGenerationLimitMb: 32, watchdogMs: 10_000, networkRequests: 0, results,
    }, null, 2));
    // Deliberate parser failures are evidence, not a passing safety assertion.
    if (results.some((r) => !r.loaded) || results.filter((r) => r.format === 'png')
      .some((r) => r.outcome !== 'returned')) process.exitCode = 1;
  })().catch((error) => { console.error(error); process.exitCode = 1; });
}
