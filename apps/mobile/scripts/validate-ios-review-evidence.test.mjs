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

function makeEvidence({ captureType = 'physical-device', screenshotReviews = {} } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kall-review-evidence-'));
  fs.copyFileSync(path.join(mobileRoot, 'store-assets', 'ios', 'screenshots', 'iphone', '1-applications.png'), path.join(directory, 'plus-subscription-review.png'));
  fs.copyFileSync(path.join(mobileRoot, 'store-assets', 'ios', 'screenshots', 'iphone', '2-application-review.png'), path.join(directory, 'premium-subscription-review.png'));
  fs.appendFileSync(path.join(directory, 'plus-subscription-review.png'), 'plus-review-fixture');
  fs.appendFileSync(path.join(directory, 'premium-subscription-review.png'), 'premium-review-fixture');
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
    subscriptionScreenshots: {
      plus: {
        filename: 'plus-subscription-review.png',
        captureSurface: 'native-app',
        appleProductIdentifier: 'com.skaldandstone.kall.plus.monthly',
        displayNameVisible: 'Kall Plus',
        localizedPriceVisible: true,
        nativePurchaseActionVisible: true,
        surroundingKallUiVisible: true,
        accountDetailsVisible: false,
        visuallyReviewedByOwner: true,
        ...screenshotReviews.plus,
      },
      premium: {
        filename: 'premium-subscription-review.png',
        captureSurface: 'native-app',
        appleProductIdentifier: 'com.skaldandstone.kall.premium.monthly',
        displayNameVisible: 'Kall Premium',
        localizedPriceVisible: true,
        nativePurchaseActionVisible: true,
        surroundingKallUiVisible: true,
        accountDetailsVisible: false,
        visuallyReviewedByOwner: true,
        ...screenshotReviews.premium,
      },
    },
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
  assert.equal(manifest.subscriptionScreenshots.plus.appleProductIdentifier, 'com.skaldandstone.kall.plus.monthly');
  assert.equal(manifest.subscriptionScreenshots.premium.appleProductIdentifier, 'com.skaldandstone.kall.premium.monthly');
  for (const asset of manifest.assets) assert.match(asset.sha256, /^[a-f0-9]{64}$/);
});

test('product-specific screenshot review metadata must match the IAP contract', () => {
  const directory = makeEvidence({ screenshotReviews: { plus: { appleProductIdentifier: 'wrong.product' } } });
  const result = run(['--evidence-dir', directory]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /plus screenshot product ID must match the IAP contract/);
});

test('screenshots must show localized prices and native purchase controls', () => {
  const directory = makeEvidence({ screenshotReviews: { premium: { localizedPriceVisible: false } } });
  const result = run(['--evidence-dir', directory]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /premium.localizedPriceVisible must be true/);
});

test('unexpected screenshot metadata cannot enter the generated manifest', () => {
  const directory = makeEvidence();
  const metadataPath = path.join(directory, 'capture-metadata.json');
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  metadata.subscriptionScreenshots.other = {
    filename: '../unreviewed.png',
  };
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  const result = run(['--evidence-dir', directory]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must contain exactly plus and premium/);
});

test('unsupported per-product metadata cannot leak into the generated manifest', () => {
  const directory = makeEvidence({ screenshotReviews: { plus: { reviewerPassword: 'must-not-pass' } } });
  const result = run(['--evidence-dir', directory]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /plus screenshot review metadata contains unsupported fields/);
  assert.equal(fs.existsSync(path.join(directory, 'review-evidence-manifest.json')), false);
});

test('Plus and Premium screenshots must be distinct', () => {
  const directory = makeEvidence();
  fs.copyFileSync(path.join(directory, 'plus-subscription-review.png'), path.join(directory, 'premium-subscription-review.png'));
  const result = run(['--evidence-dir', directory]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be distinct images/);
});

test('public listing artwork cannot be relabeled as subscription review evidence', () => {
  const directory = makeEvidence();
  fs.copyFileSync(path.join(mobileRoot, 'store-assets', 'ios', 'screenshots', 'iphone', '1-applications.png'), path.join(directory, 'plus-subscription-review.png'));
  const result = run(['--evidence-dir', directory]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot reuse public listing artwork/);
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
