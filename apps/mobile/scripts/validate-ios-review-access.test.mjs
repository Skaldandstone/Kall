import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceMobileRoot = path.resolve(scriptDirectory, '..');
const validator = path.join(scriptDirectory, 'validate-ios-review-access.mjs');
const assetFiles = [
  'review-access-status.json',
  'review-notes-draft.md',
  'listing.md',
  'review-evidence-shot-list.md',
];

function fixture() {
  const mobileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kall-review-access-'));
  const assets = path.join(mobileRoot, 'store-assets', 'ios');
  fs.mkdirSync(assets, { recursive: true });
  for (const name of assetFiles) {
    fs.copyFileSync(path.join(sourceMobileRoot, 'store-assets', 'ios', name), path.join(assets, name));
  }
  return mobileRoot;
}

function run(mobileRoot) {
  return spawnSync(process.execPath, [validator, '--mobile-root', mobileRoot], { encoding: 'utf8' });
}

test('current incomplete reviewer access is described truthfully', () => {
  const result = run(sourceMobileRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /reviewAccessComplete=false/);
});

test('claiming credentials are stored fails while access is incomplete', () => {
  const mobileRoot = fixture();
  fs.appendFileSync(
    path.join(mobileRoot, 'store-assets', 'ios', 'review-notes-draft.md'),
    '\nThe reviewer credentials are stored in App Store Connect.\n',
  );
  const result = run(mobileRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /credentials.*stored in App Store Connect/i);
});

test('partial App Store credential status fails closed', () => {
  const mobileRoot = fixture();
  const statusPath = path.join(mobileRoot, 'store-assets', 'ios', 'review-access-status.json');
  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  status.appStoreReviewUsernamePresent = true;
  fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);
  const result = run(mobileRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /username and password must be recorded together/);
});

test('credential-like email content cannot enter review drafts', () => {
  const mobileRoot = fixture();
  fs.appendFileSync(path.join(mobileRoot, 'store-assets', 'ios', 'listing.md'), '\nreviewer@example.com\n');
  const result = run(mobileRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot contain an email address/);
});
