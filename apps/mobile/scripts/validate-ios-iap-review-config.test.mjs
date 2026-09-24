import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceMobileRoot = path.resolve(scriptDirectory, '..');
const validator = path.join(scriptDirectory, 'validate-ios-iap-review-config.mjs');

const mobileFiles = [
  'app.json',
  'app.config.js',
  'eas.json',
  'store-assets/ios/subscription-review-contract.json',
  'store-assets/ios/review-evidence-status.json',
  'store-assets/ios/review-notes-draft.md',
  'store-assets/ios/listing.md',
  'store-assets/ios/review-evidence-shot-list.md',
  'src/screens/BillingScreen.tsx',
  'src/components/PurchaseBootstrap.tsx',
];

function fixture() {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kall-iap-review-'));
  const mobileRoot = path.join(repositoryRoot, 'apps', 'mobile');
  for (const relativePath of mobileFiles) {
    const destination = path.join(mobileRoot, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(sourceMobileRoot, relativePath), destination);
  }
  for (const relativePath of ['docs/NATIVE_BILLING.md', 'infrastructure/kall-production.yaml']) {
    const destination = path.join(repositoryRoot, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.resolve(sourceMobileRoot, '..', '..', relativePath), destination);
  }
  return mobileRoot;
}

function run(mobileRoot) {
  return spawnSync(process.execPath, [validator, '--mobile-root', mobileRoot], { encoding: 'utf8' });
}

test('current iOS IAP review source contract is internally consistent', () => {
  const result = run(sourceMobileRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /scope=source-only/);
});

test('Apple product identifier drift fails closed', () => {
  const mobileRoot = fixture();
  const contractPath = path.join(mobileRoot, 'store-assets/ios/subscription-review-contract.json');
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  contract.products[0].appleProductIdentifier = 'com.example.wrong.plus';
  fs.writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
  const result = run(mobileRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Apple product identifiers changed/);
});

test('hard-coded native price fails closed', () => {
  const mobileRoot = fixture();
  const billingPath = path.join(mobileRoot, 'src/screens/BillingScreen.tsx');
  fs.appendFileSync(billingPath, '\n// USD 9.00\n');
  const result = run(mobileRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot hard-code US prices/);
});

test('claiming review media is no longer required fails closed while provider status is empty', () => {
  const mobileRoot = fixture();
  const contractPath = path.join(mobileRoot, 'store-assets/ios/subscription-review-contract.json');
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  contract.reviewEvidence.plusScreenshotRequired = false;
  fs.writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
  const result = run(mobileRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Plus screenshot requirement must match/);
});

test('simulator evidence cannot be reclassified as App Review proof', () => {
  const mobileRoot = fixture();
  const contractPath = path.join(mobileRoot, 'store-assets/ios/subscription-review-contract.json');
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  contract.reviewEvidence.appReviewRecordingCaptureType = 'iOS Simulator';
  contract.reviewEvidence.simulatorEvidenceScope = 'submission-ready';
  fs.writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
  const result = run(mobileRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /App Review recording evidence must require a physical device/);
});
