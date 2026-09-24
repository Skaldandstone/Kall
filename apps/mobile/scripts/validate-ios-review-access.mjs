import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultMobileRoot = path.resolve(scriptDirectory, '..');

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  assert.ok(process.argv[index + 1], `${name} requires a value.`);
  return process.argv[index + 1];
}

const mobileRoot = path.resolve(argumentValue('--mobile-root') ?? defaultMobileRoot);
const iosAssets = path.join(mobileRoot, 'store-assets', 'ios');
const read = (name) => fs.readFileSync(path.join(iosAssets, name), 'utf8');
const status = JSON.parse(read('review-access-status.json'));
const notes = read('review-notes-draft.md');
const listing = read('listing.md');
const shotList = read('review-evidence-shot-list.md');
const combined = `${notes}\n${listing}\n${shotList}`;

assert.match(status.verifiedDate, /^\d{4}-\d{2}-\d{2}$/, 'verifiedDate must be YYYY-MM-DD.');
assert.match(status.verificationNote ?? '', /inspected directly/i);
for (const field of [
  'appStoreReviewUsernamePresent',
  'appStoreReviewPasswordPresent',
  'clerkReviewerIdentityPresent',
  'easReviewEmailPresent',
  'easReviewPasswordPresent',
]) {
  assert.equal(typeof status[field], 'boolean', `${field} must be boolean.`);
}
assert.equal(
  status.appStoreReviewUsernamePresent,
  status.appStoreReviewPasswordPresent,
  'App Store Connect reviewer username and password must be recorded together.',
);
assert.equal(
  status.easReviewEmailPresent,
  status.easReviewPasswordPresent,
  'EAS reviewer email and password must be recorded together.',
);

const complete =
  status.appStoreReviewUsernamePresent &&
  status.appStoreReviewPasswordPresent &&
  status.clerkReviewerIdentityPresent &&
  status.easReviewEmailPresent &&
  status.easReviewPasswordPresent;

assert.doesNotMatch(combined, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, 'Review drafts cannot contain an email address.');
assert.doesNotMatch(combined, /KALL_REVIEW_(?:EMAIL|PASSWORD)\s*=/i, 'Review drafts cannot contain EAS credential assignments.');

if (!complete) {
  assert.doesNotMatch(combined, /credentials? (?:are |is )?stored in App Store Connect/i);
  assert.doesNotMatch(combined, /review account is already populated/i);
  assert.match(notes, /Reviewer access remains a submission prerequisite/i);
  assert.match(listing, /Before submission, enter the dedicated reviewer username and password/i);
  assert.match(shotList, /after the dedicated reviewer identity and App Store Connect credentials are\s+verified/i);
}

assert.ok(status.limitations.some((value) => /field presence only/i.test(value)));
assert.ok(status.limitations.some((value) => /does not contain or prove a reviewer credential/i.test(value)));
assert.ok(status.limitations.some((value) => /does not prove a successful native sign-in/i.test(value)));

console.log('iOS reviewer-access source gate passed.');
console.log(`reviewAccessComplete=${complete}`);
console.log('scope=nonsecret field-presence snapshot; credential validity, native sign-in, and acceptance remain unproven');
