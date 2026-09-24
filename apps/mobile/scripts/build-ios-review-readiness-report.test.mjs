import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceMobileRoot = path.resolve(scriptDirectory, '..');
const reporter = path.join(scriptDirectory, 'build-ios-review-readiness-report.mjs');
const assetFiles = [
  'subscription-review-contract.json',
  'review-access-status.json',
  'review-evidence-status.json',
  'simulator-review-evidence-status.json',
  'review-notes-draft.md',
];

function fixture() {
  const mobileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kall-review-readiness-'));
  const assets = path.join(mobileRoot, 'store-assets', 'ios');
  fs.mkdirSync(assets, { recursive: true });
  fs.copyFileSync(path.join(sourceMobileRoot, 'app.json'), path.join(mobileRoot, 'app.json'));
  for (const name of assetFiles) {
    fs.copyFileSync(path.join(sourceMobileRoot, 'store-assets', 'ios', name), path.join(assets, name));
  }
  return mobileRoot;
}

function run(mobileRoot, extra = []) {
  return spawnSync(process.execPath, [reporter, '--mobile-root', mobileRoot, ...extra], { encoding: 'utf8' });
}

function reportFrom(result) {
  const line = result.stdout.trim().split(/\r?\n/).find((value) => value.startsWith('{'));
  return JSON.parse(line);
}

test('current report lists every truthful source blocker without secrets', () => {
  const result = run(sourceMobileRoot);
  assert.equal(result.status, 0, result.stderr);
  const report = reportFrom(result);
  assert.equal(report.status, 'blocked');
  assert.deepEqual(report.blockers, [
    'app-store-review-credentials',
    'clerk-reviewer-identity',
    'eas-review-capture-credentials',
    'authenticated-simulator-review-package',
    'app-review-recording-upload',
    'plus-subscription-review-screenshot',
    'premium-subscription-review-screenshot',
    'review-notes-finalization',
  ]);
  assert.doesNotMatch(JSON.stringify(report), /@|password/i);
});

test('require-source-complete fails closed for the current blocked state', () => {
  const result = run(sourceMobileRoot, ['--require-source-complete']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /source checklist is blocked/);
});

test('partial credential status is rejected instead of summarized', () => {
  const mobileRoot = fixture();
  const statusPath = path.join(mobileRoot, 'store-assets', 'ios', 'review-access-status.json');
  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  status.easReviewEmailPresent = true;
  fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);
  const result = run(mobileRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /email\/password status is internally inconsistent/);
});

test('complete snapshots still require final notes and retain evidence limitations', () => {
  const mobileRoot = fixture();
  const assets = path.join(mobileRoot, 'store-assets', 'ios');
  const accessPath = path.join(assets, 'review-access-status.json');
  const access = JSON.parse(fs.readFileSync(accessPath, 'utf8'));
  for (const field of [
    'appStoreReviewUsernamePresent',
    'appStoreReviewPasswordPresent',
    'clerkReviewerIdentityPresent',
    'easReviewEmailPresent',
    'easReviewPasswordPresent',
  ]) access[field] = true;
  fs.writeFileSync(accessPath, `${JSON.stringify(access, null, 2)}\n`);

  const evidencePath = path.join(assets, 'review-evidence-status.json');
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  evidence.appReviewAttachmentPresent = true;
  evidence.plusReviewScreenshotPresent = true;
  evidence.premiumReviewScreenshotPresent = true;
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

  const simulatorPath = path.join(assets, 'simulator-review-evidence-status.json');
  const simulator = JSON.parse(fs.readFileSync(simulatorPath, 'utf8'));
  simulator.authenticatedJourneyPresent = true;
  fs.writeFileSync(simulatorPath, `${JSON.stringify(simulator, null, 2)}\n`);

  let result = run(mobileRoot);
  assert.deepEqual(reportFrom(result).blockers, ['review-notes-finalization']);

  fs.writeFileSync(path.join(assets, 'review-notes-draft.md'), '# Final review notes\n\nNo credentials are stored in source.\n');
  result = run(mobileRoot, ['--require-source-complete']);
  assert.equal(result.status, 0, result.stderr);
  const report = reportFrom(result);
  assert.equal(report.status, 'source-checklist-complete');
  assert.equal(report.sourceChecklistComplete, true);
  assert.ok(report.limitations.every((value) => /does not prove|source snapshots only/i.test(value)));
});
