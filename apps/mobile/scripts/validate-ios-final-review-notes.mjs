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
const assetsRoot = path.join(mobileRoot, 'store-assets', 'ios');
const read = (name) => fs.readFileSync(path.join(assetsRoot, name), 'utf8');
const readJson = (name) => JSON.parse(read(name));
const app = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'app.json'), 'utf8')).expo;
const contract = readJson('subscription-review-contract.json');
const access = readJson('review-access-status.json');
const evidence = readJson('review-evidence-status.json');
const physical = readJson('physical-review-evidence-status.json');
const status = readJson('final-review-notes-status.json');
const notes = read('review-notes-draft.md');

assert.match(status.verifiedDate ?? '', /^\d{4}-\d{2}-\d{2}$/, 'verifiedDate must be YYYY-MM-DD.');
assert.equal(status.appVersion, app.version, 'Final-note status version must match the app.');
assert.equal(status.appVersion, contract.appVersion, 'Final-note status version must match the IAP contract.');
assert.equal(status.appBuildVersion, contract.appBuildVersion, 'Final-note status build must match the submitted build.');
for (const field of ['finalized', 'reviewedAgainstSubmittedBuild', 'pendingParagraphRemoved']) {
  assert.equal(typeof status[field], 'boolean', `${field} must be boolean.`);
}
assert.equal(
  status.finalized,
  status.reviewedAgainstSubmittedBuild && status.pendingParagraphRemoved,
  'Finalized status requires submitted-build review and pending-paragraph removal.',
);
assert.doesNotMatch(notes, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, 'Final review notes cannot contain an email address.');
assert.doesNotMatch(notes, /KALL_REVIEW_(?:EMAIL|PASSWORD)|password\s*[=:]/i, 'Final review notes cannot contain credential assignments.');

const pendingPattern = /remain submission prerequisites|Reviewer access remains a submission prerequisite|Do not state that access or media is ready/i;
if (!status.finalized) {
  assert.match(notes, pendingPattern, 'Draft notes must retain an explicit pending-evidence paragraph.');
} else {
  const accessComplete =
    access.appStoreReviewUsernamePresent &&
    access.appStoreReviewPasswordPresent &&
    access.clerkReviewerIdentityPresent &&
    access.easReviewEmailPresent &&
    access.easReviewPasswordPresent;
  assert.equal(accessComplete, true, 'Final notes require complete reviewer-access snapshots.');
  assert.equal(physical.packageValidated, true, 'Final notes require a validated physical-device package.');
  assert.equal(physical.physicalDeviceRecordingPresent, true, 'Final notes require a physical-device recording.');
  assert.equal(physical.plusNativeScreenshotPresent, true, 'Final notes require a native Plus screenshot.');
  assert.equal(physical.premiumNativeScreenshotPresent, true, 'Final notes require a native Premium screenshot.');
  assert.equal(evidence.appReviewAttachmentPresent, true, 'Final notes require the App Review recording upload.');
  assert.equal(evidence.plusReviewScreenshotPresent, true, 'Final notes require the Plus screenshot upload.');
  assert.equal(evidence.premiumReviewScreenshotPresent, true, 'Final notes require the Premium screenshot upload.');
  assert.doesNotMatch(notes, pendingPattern, 'Final notes cannot retain pending-evidence language.');
  assert.doesNotMatch(notes, /Simulator|emulated-device/i, 'Final notes cannot present simulator evidence as the review package.');
  for (const [pattern, message] of [
    [/Kall 1\.2\.0 \(21\)/i, 'Final notes must identify the submitted version and build.'],
    [/Profile.+Plan/is, 'Final notes must explain how to reach native plans.'],
    [/Plus and Premium/i, 'Final notes must identify both native products.'],
    [/localized prices/i, 'Final notes must explain localized store pricing.'],
    [/Restore purchases/i, 'Final notes must identify the restore control.'],
    [/Apple's sandbox/i, 'Final notes must direct completed review purchases to Apple sandbox.'],
    [/Account deletion.+Profile/is, 'Final notes must explain where account deletion is available.'],
    [/never submits a job application/is, 'Final notes must state the no-automatic-submission boundary.'],
  ]) assert.match(notes, pattern, message);
}

assert.ok(status.limitations.some((value) => /status only/i.test(value)));
assert.ok(status.limitations.some((value) => /does not prove reviewer access, provider upload state, App Review, or acceptance/i.test(value)));
console.log('iOS final-review-notes source gate passed.');
console.log(`notesFinalized=${status.finalized}`);
console.log('scope=nonsecret source status; reviewer access, provider upload, review, and acceptance remain separately proven');
