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
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(assetsRoot, name), 'utf8'));
const app = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'app.json'), 'utf8')).expo;
const contract = readJson('subscription-review-contract.json');
const access = readJson('review-access-status.json');
const evidence = readJson('review-evidence-status.json');
const simulator = readJson('simulator-review-evidence-status.json');
const physical = readJson('physical-review-evidence-status.json');
const finalNotes = readJson('final-review-notes-status.json');
const notes = fs.readFileSync(path.join(assetsRoot, 'review-notes-draft.md'), 'utf8');

assert.equal(contract.appVersion, app.version, 'IAP contract version must match the mobile app.');
assert.equal(contract.appVersion, evidence.appVersion, 'IAP and evidence versions must agree.');
assert.equal(contract.appBuildVersion, evidence.appBuildVersion, 'IAP and evidence build numbers must agree.');
assert.equal(contract.appVersion, simulator.appVersion, 'IAP and simulator evidence versions must agree.');
assert.equal(contract.appBuildVersion, simulator.appBuildVersion, 'IAP and simulator evidence builds must agree.');
assert.equal(contract.appVersion, physical.appVersion, 'IAP and physical evidence versions must agree.');
assert.equal(contract.appBuildVersion, physical.appBuildVersion, 'IAP and physical evidence builds must agree.');
assert.equal(contract.appVersion, finalNotes.appVersion, 'IAP and final-note versions must agree.');
assert.equal(contract.appBuildVersion, finalNotes.appBuildVersion, 'IAP and final-note builds must agree.');
assert.equal(simulator.captureType, 'iOS Simulator', 'Review capture must be identified as emulated-device evidence.');
assert.match(simulator.workflowRunId ?? '', /^[a-f0-9-]{36}$/i, 'Simulator evidence must identify its EAS workflow run.');
assert.match(simulator.sourceCommit ?? '', /^[a-f0-9]{40}$/i, 'Simulator evidence must identify its source commit.');
assert.match(simulator.easBuildId ?? '', /^[a-f0-9-]{36}$/i, 'Simulator evidence must identify its EAS build.');
assert.match(simulator.buildFingerprint ?? '', /^[a-f0-9]{40}$/i, 'Simulator evidence must identify its build fingerprint.');
assert.equal(simulator.workflowSucceeded, true, 'Simulator evidence workflow must have succeeded.');
assert.equal(typeof simulator.captureValidated, 'boolean', 'Simulator capture validation status must be boolean.');
assert.equal(typeof simulator.authenticatedJourneyPresent, 'boolean', 'Authenticated simulator journey status must be boolean.');
assert.equal(simulator.coverage, 'native-launch-and-signed-out-sign-in-rendering-only');
assert.match(simulator.screenshot?.dimensions ?? '', /^(?:1284x2778|1260x2736|1290x2796|1320x2868)$/);
assert.match(simulator.screenshot?.sha256 ?? '', /^[a-f0-9]{64}$/i);
assert.match(simulator.recording?.sha256 ?? '', /^[a-f0-9]{64}$/i);
assert.ok(simulator.recording?.bytes >= 1024 * 1024, 'Simulator recording is unexpectedly small.');
const simulatorLimitations = Array.isArray(simulator.limitations) ? simulator.limitations.join(' ') : '';
assert.match(simulatorLimitations, /signed-out sign-in rendering only/i);
assert.match(simulatorLimitations, /does not prove authentication/i);
assert.match(simulatorLimitations, /internal QA evidence/i);
assert.match(simulatorLimitations, /cannot satisfy the App Review recording or resubmission gate/i);
assert.equal(contract.reviewEvidence.appReviewRecordingCaptureType, 'physical-device');
assert.equal(contract.reviewEvidence.simulatorEvidenceScope, 'internal-qa-only');
for (const field of [
  'packageValidated',
  'physicalDeviceRecordingPresent',
  'plusNativeScreenshotPresent',
  'premiumNativeScreenshotPresent',
]) assert.equal(typeof physical[field], 'boolean', `${field} must be boolean.`);
assert.equal(
  physical.packageValidated,
  physical.physicalDeviceRecordingPresent && physical.plusNativeScreenshotPresent && physical.premiumNativeScreenshotPresent,
  'Physical package validation must match the presence of all three required assets.',
);
assert.match((physical.limitations ?? []).join(' '), /Simulator evidence cannot satisfy/i);
assert.equal(
  access.appStoreReviewUsernamePresent,
  access.appStoreReviewPasswordPresent,
  'App Store Connect reviewer username/password status is internally inconsistent.',
);
assert.equal(
  access.easReviewEmailPresent,
  access.easReviewPasswordPresent,
  'EAS reviewer email/password status is internally inconsistent.',
);
for (const field of ['finalized', 'reviewedAgainstSubmittedBuild', 'pendingParagraphRemoved']) {
  assert.equal(typeof finalNotes[field], 'boolean', `${field} must be boolean.`);
}
assert.equal(
  finalNotes.finalized,
  finalNotes.reviewedAgainstSubmittedBuild && finalNotes.pendingParagraphRemoved,
  'Finalized notes require submitted-build review and pending-paragraph removal.',
);

const blockers = [];
const appStoreCredentialsComplete = access.appStoreReviewUsernamePresent && access.appStoreReviewPasswordPresent;
const easCaptureCredentialsComplete = access.easReviewEmailPresent && access.easReviewPasswordPresent;
if (finalNotes.finalized) {
  assert.equal(appStoreCredentialsComplete, true, 'Final notes require App Store reviewer credentials.');
  assert.equal(access.clerkReviewerIdentityPresent, true, 'Final notes require the production Clerk reviewer identity.');
  assert.equal(easCaptureCredentialsComplete, true, 'Final notes require EAS reviewer credentials.');
  assert.equal(physical.packageValidated, true, 'Final notes require the validated physical-device package.');
  assert.equal(evidence.appReviewAttachmentPresent, true, 'Final notes require the App Review recording upload.');
  assert.equal(evidence.plusReviewScreenshotPresent, true, 'Final notes require the Plus screenshot upload.');
  assert.equal(evidence.premiumReviewScreenshotPresent, true, 'Final notes require the Premium screenshot upload.');
}
if (!appStoreCredentialsComplete) blockers.push('app-store-review-credentials');
if (!access.clerkReviewerIdentityPresent) blockers.push('clerk-reviewer-identity');
if (!easCaptureCredentialsComplete) blockers.push('eas-review-capture-credentials');
if (!physical.packageValidated) blockers.push('physical-device-review-package');
if (!evidence.appReviewAttachmentPresent) blockers.push('app-review-recording-upload');
if (!evidence.plusReviewScreenshotPresent) blockers.push('plus-subscription-review-screenshot');
if (!evidence.premiumReviewScreenshotPresent) blockers.push('premium-subscription-review-screenshot');

const pendingNotesPattern = /remain submission prerequisites|Reviewer access remains a submission prerequisite|Do not state that access or media is ready/i;
const notesFinalized = finalNotes.finalized;
if (notesFinalized) {
  assert.doesNotMatch(notes, pendingNotesPattern, 'Finalized notes cannot retain pending-evidence language.');
  assert.doesNotMatch(notes, /Simulator|emulated-device/i, 'Finalized notes cannot present simulator evidence as the review package.');
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
} else assert.match(notes, pendingNotesPattern, 'Unfinalized notes must retain pending-evidence language.');
if (!notesFinalized) blockers.push('review-notes-finalization');

const report = {
  schemaVersion: 1,
  status: blockers.length === 0 ? 'source-checklist-complete' : 'blocked',
  appVersion: contract.appVersion,
  appBuildVersion: contract.appBuildVersion,
  bundleIdentifier: contract.bundleIdentifier,
  sourceChecklistComplete: blockers.length === 0,
  checks: {
    appStoreCredentialsComplete,
    clerkReviewerIdentityPresent: access.clerkReviewerIdentityPresent,
    easCaptureCredentialsComplete,
    simulatorCaptureValidated: simulator.captureValidated,
    simulatorEvidenceScope: contract.reviewEvidence.simulatorEvidenceScope,
    simulatorCoverage: simulator.coverage,
    physicalReviewPackageValidated: physical.packageValidated,
    appReviewAttachmentPresent: evidence.appReviewAttachmentPresent,
    plusReviewScreenshotPresent: evidence.plusReviewScreenshotPresent,
    premiumReviewScreenshotPresent: evidence.premiumReviewScreenshotPresent,
    notesFinalized,
    iapProductCount: contract.products.length,
  },
  simulatorEvidence: {
    workflowRunId: simulator.workflowRunId,
    sourceCommit: simulator.sourceCommit,
    easBuildId: simulator.easBuildId,
    buildFingerprint: simulator.buildFingerprint,
    coverage: simulator.coverage,
  },
  blockers,
  limitations: [
    'This report aggregates nonsecret source snapshots only.',
    'Source checklist completion does not prove credential validity or a native sign-in.',
    'Simulator evidence is internal QA only and cannot satisfy the physical-device App Review gate.',
    'Source checklist completion does not prove provider upload state, App Review, or acceptance.',
  ],
};

const outputValue = argumentValue('--output');
if (outputValue) {
  const outputPath = path.resolve(process.cwd(), outputValue);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`report=${outputPath}`);
}
console.log(JSON.stringify(report));

if (process.argv.includes('--require-source-complete') && !report.sourceChecklistComplete) {
  console.error(`iOS review source checklist is blocked: ${blockers.join(', ')}`);
  process.exit(2);
}
