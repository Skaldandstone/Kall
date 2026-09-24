import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptDirectory, '..');
const validator = path.join(scriptDirectory, 'validate-ios-simulator-review-evidence.mjs');

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function run(directory) {
  return spawnSync(process.execPath, [validator, '--evidence-dir', directory], {
    cwd: mobileRoot,
    encoding: 'utf8',
  });
}

function makeEvidence(overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kall-simulator-evidence-'));
  const screenshotPath = path.join(directory, '01-kall-sign-in.png');
  fs.copyFileSync(
    path.join(mobileRoot, 'store-assets', 'ios', 'screenshots', 'iphone', '1-applications.png'),
    screenshotPath,
  );
  const screenshot = fs.readFileSync(screenshotPath);
  const dimensions = `${screenshot.readUInt32BE(16)}x${screenshot.readUInt32BE(20)}`;
  const recording = Buffer.alloc(1024 * 1024);
  recording.write('ftyp', 4, 'ascii');
  fs.writeFileSync(path.join(directory, 'kall-ios-review-flow.mp4'), recording);
  const manifest = {
    captureType: 'iOS Simulator',
    limitations: [
      'This is simulated-device media, not physical-device evidence.',
      'The flow proves native launch and signed-out sign-in rendering only.',
    ],
    sourceCommit: '0000000000000000000000000000000000000001',
    easBuildId: '00000000-0000-0000-0000-000000000001',
    appVersion: '1.2.0',
    appBuildVersion: '21',
    buildFingerprint: '0000000000000000000000000000000000000002',
    deviceType: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro-Max',
    runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
    screenshot: {
      file: '01-kall-sign-in.png',
      dimensions,
      bytes: screenshot.length,
      sha256: digest(screenshot),
    },
    recording: {
      file: 'kall-ios-review-flow.mp4',
      bytes: recording.length,
      sha256: digest(recording),
    },
    ...overrides,
  };
  fs.writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return directory;
}

test('valid Expo simulator bundle produces a hashed validation report', () => {
  const directory = makeEvidence();
  const result = run(directory);
  assert.equal(result.status, 0, result.stderr);
  const validation = JSON.parse(fs.readFileSync(path.join(directory, 'simulator-evidence-validation.json'), 'utf8'));
  assert.equal(validation.captureType, 'iOS Simulator');
  assert.equal(validation.assets.length, 3);
  assert.match(validation.limitations.join(' '), /does not prove physical-device behavior/i);
  for (const asset of validation.assets) assert.match(asset.sha256, /^[a-f0-9]{64}$/);
});

test('physical-device claims cannot pass as simulator evidence', () => {
  const directory = makeEvidence({ captureType: 'physical-device' });
  const result = run(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Capture must be identified as iOS Simulator evidence/);
});

test('artifact hash drift fails closed', () => {
  const directory = makeEvidence();
  fs.appendFileSync(path.join(directory, '01-kall-sign-in.png'), Buffer.from('drift'));
  const result = run(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /byte count does not match the artifact/);
});

test('missing simulator media fails closed', () => {
  const directory = makeEvidence();
  fs.rmSync(path.join(directory, 'kall-ios-review-flow.mp4'));
  const result = run(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing kall-ios-review-flow\.mp4/);
});
