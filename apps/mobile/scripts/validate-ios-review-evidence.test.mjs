import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptDirectory, '..');
const validator = path.join(scriptDirectory, 'validate-ios-review-evidence.mjs');

function run(args = []) {
  return spawnSync(process.execPath, [validator, ...args], { cwd: mobileRoot, encoding: 'utf8' });
}

function makeEvidence({ captureType = 'physical-device' } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kall-review-evidence-'));
  fs.copyFileSync(path.join(mobileRoot, 'store-assets', 'ios', 'screenshots', 'iphone', '1-applications.png'), path.join(directory, 'plus-subscription-review.png'));
  fs.copyFileSync(path.join(mobileRoot, 'store-assets', 'ios', 'screenshots', 'iphone', '2-application-review.png'), path.join(directory, 'premium-subscription-review.png'));
  const video = Buffer.alloc(1024 * 1024);
  video.write('ftyp', 4, 'ascii');
  fs.writeFileSync(path.join(directory, 'kall-ios-physical-review.mp4'), video);
  fs.writeFileSync(path.join(directory, 'capture-metadata.json'), `${JSON.stringify({
    captureType,
    deviceModel: captureType === 'physical-device' ? 'Test fixture iPhone' : 'iOS Simulator',
    iosVersion: 'Test fixture iOS',
    appVersion: '1.2.0',
    appBuildVersion: '21',
    sourceCommit: '0000000000000000000000000000000000000001',
    capturedAt: '2026-09-24T00:00:00Z',
    oneContinuousTake: true,
    credentialsVisible: false,
    purchaseCompleted: false,
    accountDeleted: false,
    reviewedByOwner: true,
  }, null, 2)}\n`);
  return directory;
}

test('current review notes accurately describe absent attachments', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /attachment=false, plus=false, premium=false/);
});

test('complete physical-device fixture produces a hashed evidence manifest', () => {
  const directory = makeEvidence();
  const result = run(['--evidence-dir', directory]);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'review-evidence-manifest.json'), 'utf8'));
  assert.equal(manifest.captureType, 'physical-device');
  assert.equal(manifest.assets.length, 4);
  for (const asset of manifest.assets) assert.match(asset.sha256, /^[a-f0-9]{64}$/);
});

test('simulator metadata cannot pass as Apple physical-device evidence', () => {
  const directory = makeEvidence({ captureType: 'iOS Simulator' });
  const result = run(['--evidence-dir', directory]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Simulator capture metadata is not accepted/);
});

test('missing media fails closed', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kall-empty-review-evidence-'));
  const result = run(['--evidence-dir', directory]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing kall-ios-physical-review\.mp4/);
});
