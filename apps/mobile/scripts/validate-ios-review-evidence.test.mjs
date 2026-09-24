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
const validator = path.join(scriptDirectory, 'validate-ios-review-evidence.mjs');

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function run(directory) {
  return spawnSync(process.execPath, [validator, '--evidence-dir', directory], { cwd: mobileRoot, encoding: 'utf8' });
}

function runSourcePreflight() {
  return spawnSync(process.execPath, [validator], { cwd: mobileRoot, encoding: 'utf8' });
}

function makeEvidence(overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kall-emulated-review-evidence-'));
  const screenshotSource = path.join(mobileRoot, 'store-assets', 'ios', 'screenshots', 'iphone', '1-applications.png');
  for (const filename of ['04-native-plans.png', '05-native-premium.png']) fs.copyFileSync(screenshotSource, path.join(directory, filename));
  const recording = Buffer.alloc(1024 * 1024);
  recording.write('ftyp', 4, 'ascii');
  fs.writeFileSync(path.join(directory, 'kall-ios-authenticated-review-flow.mp4'), recording);
  const assetNames = ['04-native-plans.png', '05-native-premium.png', 'kall-ios-authenticated-review-flow.mp4'];
  const manifest = {
    captureType: 'iOS Simulator',
    limitations: ['This is simulated-device media and must not be described as physical-device evidence.'],
    sourceCommit: '0000000000000000000000000000000000000001',
    easBuildId: '00000000-0000-0000-0000-000000000001',
    appVersion: '1.2.0',
    appBuildVersion: '21',
    buildFingerprint: '0000000000000000000000000000000000000002',
    deviceType: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro-Max',
    runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
    assets: assetNames.map((filename) => {
      const bytes = fs.readFileSync(path.join(directory, filename));
      return { file: filename, bytes: bytes.length, sha256: digest(bytes) };
    }),
    ...overrides,
  };
  fs.writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return directory;
}

test('authenticated simulator package produces a hashed validation report', () => {
  const directory = makeEvidence();
  const result = run(directory);
  assert.equal(result.status, 0, result.stderr);
  const validation = JSON.parse(fs.readFileSync(path.join(directory, 'review-evidence-manifest.json'), 'utf8'));
  assert.equal(validation.captureType, 'iOS Simulator');
  assert.equal(validation.assets.length, 4);
  assert.match(validation.limitations.join(' '), /does not prove physical-device behavior/i);
  for (const asset of validation.assets) assert.match(asset.sha256, /^[a-f0-9]{64}$/);
});

test('current source copy accurately describes absent provider uploads', () => {
  const result = runSourcePreflight();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /attachment=false, plus=false, premium=false/);
});

test('physical-device claims cannot pass as emulated-device evidence', () => {
  const directory = makeEvidence({ captureType: 'physical-device' });
  const result = run(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be identified as iOS Simulator evidence/);
});

test('artifact hash drift fails closed', () => {
  const directory = makeEvidence();
  fs.appendFileSync(path.join(directory, '04-native-plans.png'), Buffer.from('drift'));
  const result = run(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /byte count does not match the artifact/);
});

test('missing simulator media fails closed', () => {
  const directory = makeEvidence();
  fs.rmSync(path.join(directory, 'kall-ios-authenticated-review-flow.mp4'));
  const result = run(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing kall-ios-authenticated-review-flow\.mp4/);
});
