import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceMobileRoot = path.resolve(scriptDirectory, '..');
const validator = path.join(scriptDirectory, 'validate-ios-final-review-notes.mjs');
const assetFiles = [
  'subscription-review-contract.json',
  'review-access-status.json',
  'review-evidence-status.json',
  'physical-review-evidence-status.json',
  'final-review-notes-status.json',
  'review-notes-draft.md',
];

function fixture() {
  const mobileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kall-final-notes-'));
  const assets = path.join(mobileRoot, 'store-assets', 'ios');
  fs.mkdirSync(assets, { recursive: true });
  fs.copyFileSync(path.join(sourceMobileRoot, 'app.json'), path.join(mobileRoot, 'app.json'));
  for (const name of assetFiles) fs.copyFileSync(path.join(sourceMobileRoot, 'store-assets', 'ios', name), path.join(assets, name));
  return mobileRoot;
}

function run(mobileRoot) {
  return spawnSync(process.execPath, [validator, '--mobile-root', mobileRoot], { encoding: 'utf8' });
}

function setReadySnapshots(mobileRoot) {
  const assets = path.join(mobileRoot, 'store-assets', 'ios');
  const accessPath = path.join(assets, 'review-access-status.json');
  const access = JSON.parse(fs.readFileSync(accessPath, 'utf8'));
  for (const field of ['appStoreReviewUsernamePresent', 'appStoreReviewPasswordPresent', 'clerkReviewerIdentityPresent', 'easReviewEmailPresent', 'easReviewPasswordPresent']) access[field] = true;
  fs.writeFileSync(accessPath, `${JSON.stringify(access, null, 2)}\n`);
  const evidencePath = path.join(assets, 'review-evidence-status.json');
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  evidence.appReviewAttachmentPresent = true;
  evidence.plusReviewScreenshotPresent = true;
  evidence.premiumReviewScreenshotPresent = true;
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  const physicalPath = path.join(assets, 'physical-review-evidence-status.json');
  const physical = JSON.parse(fs.readFileSync(physicalPath, 'utf8'));
  physical.packageValidated = true;
  physical.physicalDeviceRecordingPresent = true;
  physical.plusNativeScreenshotPresent = true;
  physical.premiumNativeScreenshotPresent = true;
  fs.writeFileSync(physicalPath, `${JSON.stringify(physical, null, 2)}\n`);
  const statusPath = path.join(assets, 'final-review-notes-status.json');
  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  status.finalized = true;
  status.reviewedAgainstSubmittedBuild = true;
  status.pendingParagraphRemoved = true;
  fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);
}

const validFinalNotes = `# App Review notes for Kall 1.2.0 (21)

Kall never submits a job application without the user's action.
Open Profile, then Plan to see Kall Plus and Premium with localized prices and Restore purchases.
Use Apple's sandbox for any completed review purchase.
Account deletion is available from Profile after a confirmation step.
`;

test('current pending notes pass truthfully as an unfinished draft', () => {
  const result = run(sourceMobileRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /notesFinalized=false/);
});

test('finalized status fails while reviewer and evidence snapshots are incomplete', () => {
  const mobileRoot = fixture();
  const statusPath = path.join(mobileRoot, 'store-assets', 'ios', 'final-review-notes-status.json');
  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  status.finalized = true;
  status.reviewedAgainstSubmittedBuild = true;
  status.pendingParagraphRemoved = true;
  fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);
  fs.writeFileSync(path.join(mobileRoot, 'store-assets', 'ios', 'review-notes-draft.md'), validFinalNotes);
  const result = run(mobileRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /complete reviewer-access snapshots/);
});

test('complete snapshots and complete final notes pass', () => {
  const mobileRoot = fixture();
  setReadySnapshots(mobileRoot);
  fs.writeFileSync(path.join(mobileRoot, 'store-assets', 'ios', 'review-notes-draft.md'), validFinalNotes);
  const result = run(mobileRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /notesFinalized=true/);
});

test('thin final notes fail even when snapshots are complete', () => {
  const mobileRoot = fixture();
  setReadySnapshots(mobileRoot);
  fs.writeFileSync(path.join(mobileRoot, 'store-assets', 'ios', 'review-notes-draft.md'), '# Final notes\n');
  const result = run(mobileRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /submitted version and build/);
});

test('simulator language cannot enter finalized review notes', () => {
  const mobileRoot = fixture();
  setReadySnapshots(mobileRoot);
  fs.writeFileSync(path.join(mobileRoot, 'store-assets', 'ios', 'review-notes-draft.md'), `${validFinalNotes}\nSimulator recording attached.\n`);
  const result = run(mobileRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot present simulator evidence/);
});
