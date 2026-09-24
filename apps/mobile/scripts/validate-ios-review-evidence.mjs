import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptDirectory, '..');
const iosAssets = path.join(mobileRoot, 'store-assets', 'ios');
const status = JSON.parse(fs.readFileSync(path.join(iosAssets, 'review-evidence-status.json'), 'utf8'));
const listing = fs.readFileSync(path.join(iosAssets, 'listing.md'), 'utf8');
const notes = fs.readFileSync(path.join(iosAssets, 'review-notes-draft.md'), 'utf8');
const shotList = fs.readFileSync(path.join(iosAssets, 'review-evidence-shot-list.md'), 'utf8');
const combinedNotes = `${listing}\n${notes}`;

assert.equal(status.appVersion, '1.2.0', 'Review evidence status must identify the submitted app version.');
assert.equal(status.appBuildVersion, '21', 'Review evidence status must identify submitted build 21.');
assert.match(status.verifiedDate, /^\d{4}-\d{2}-\d{2}$/, 'verifiedDate must be YYYY-MM-DD.');
assert.match(status.verificationNote ?? '', /App Store Connect was inspected directly/i);

if (!status.appReviewAttachmentPresent) {
  assert.doesNotMatch(combinedNotes, /(?:video|recording) (?:is |has been )?attached/i);
  assert.match(notes, /remain submission prerequisites/i);
}
if (!status.plusReviewScreenshotPresent || !status.premiumReviewScreenshotPresent) {
  assert.doesNotMatch(combinedNotes, /subscription(?:-review)? screenshots? (?:are |have been )?attached/i);
  assert.match(listing, /Before\s+submission, add separate Plus and Premium subscription-review screenshots/i);
}

assert.match(listing, /emulated-device evidence/i);
assert.match(notes, /emulated-device media/i);
assert.match(shotList, /Expo-managed iOS\s+Simulator/i);
assert.doesNotMatch(`${listing}\n${notes}\n${shotList}`, /upload the physical-device recording/i);

const evidenceArg = process.argv.indexOf('--evidence-dir');
if (evidenceArg === -1) {
  console.log('iOS App Review source preflight passed.');
  console.log(`attachment=${status.appReviewAttachmentPresent}, plus=${status.plusReviewScreenshotPresent}, premium=${status.premiumReviewScreenshotPresent}`);
  process.exit(0);
}

const evidenceValue = process.argv[evidenceArg + 1];
assert.ok(evidenceValue, '--evidence-dir requires a directory path.');
const evidenceDirectory = path.resolve(process.cwd(), evidenceValue);
assert.ok(fs.existsSync(evidenceDirectory), 'Evidence directory does not exist.');
assert.ok(fs.statSync(evidenceDirectory).isDirectory(), 'Evidence path must be a directory.');

const requiredFiles = {
  video: 'kall-ios-authenticated-review-flow.mp4',
  plus: '04-native-plans.png',
  premium: '05-native-premium.png',
  manifest: 'manifest.json',
};
for (const filename of Object.values(requiredFiles)) {
  assert.ok(fs.existsSync(path.join(evidenceDirectory, filename)), `Missing ${filename}.`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(evidenceDirectory, requiredFiles.manifest), 'utf8'));
assert.equal(manifest.captureType, 'iOS Simulator', 'Capture must be identified as iOS Simulator evidence.');
assert.equal(manifest.appVersion, status.appVersion, 'Capture app version does not match the submitted version.');
assert.equal(manifest.appBuildVersion, status.appBuildVersion, 'Capture build does not match the submitted build.');
assert.match(manifest.sourceCommit ?? '', /^[a-f0-9]{40}$/i, 'Capture sourceCommit must be a full Git SHA.');
assert.match(manifest.easBuildId ?? '', /^[a-f0-9-]{36}$/i, 'Capture must identify the reused EAS build.');
assert.match(manifest.buildFingerprint ?? '', /^[a-f0-9]{40}$/i, 'Capture must identify the EAS build fingerprint.');
assert.match(manifest.deviceType ?? '', /Simulator\.SimDeviceType\.iPhone/i, 'Capture must identify an iPhone Simulator.');
assert.match(manifest.runtime ?? '', /Simulator\.SimRuntime\.iOS/i, 'Capture must identify an iOS Simulator runtime.');
const limitations = Array.isArray(manifest.limitations) ? manifest.limitations.join(' ') : '';
assert.match(limitations, /simulat|emulated/i, 'Manifest must identify the capture as emulated-device evidence.');
assert.match(limitations, /not.*physical-device|must not be described as physical-device/i, 'Manifest must reject physical-device claims.');
assert.doesNotMatch(JSON.stringify(manifest), /KALL_REVIEW_PASSWORD|password\s*[=:]/i, 'Manifest cannot contain a reviewer password.');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function pngDimensions(filePath) {
  const bytes = fs.readFileSync(filePath);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${path.basename(filePath)} must be a PNG.`);
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

const assets = new Map((manifest.assets ?? []).map((asset) => [asset.file, asset]));
function validateAsset(filename) {
  const filePath = path.join(evidenceDirectory, filename);
  const asset = assets.get(filename);
  assert.ok(asset, `Manifest is missing ${filename}.`);
  assert.equal(asset.bytes, fs.statSync(filePath).size, `${filename} byte count does not match the artifact.`);
  assert.equal(asset.sha256, sha256(filePath), `${filename} SHA-256 does not match the artifact.`);
}

const allowedIphoneDimensions = new Set(['1179x2556', '1242x2688', '1284x2778', '1290x2796', '1320x2868']);
for (const screenshotName of [requiredFiles.plus, requiredFiles.premium]) {
  const dimensions = pngDimensions(path.join(evidenceDirectory, screenshotName));
  assert.ok(allowedIphoneDimensions.has(dimensions), `${screenshotName} has unsupported dimensions ${dimensions}.`);
  validateAsset(screenshotName);
}

const videoPath = path.join(evidenceDirectory, requiredFiles.video);
const video = fs.readFileSync(videoPath);
assert.ok(video.length >= 1024 * 1024, 'Simulator review video is unexpectedly small.');
assert.equal(video.subarray(4, 8).toString('ascii'), 'ftyp', 'Review video must be an MP4 container.');
validateAsset(requiredFiles.video);

const validation = {
  captureType: manifest.captureType,
  appVersion: manifest.appVersion,
  appBuildVersion: manifest.appBuildVersion,
  sourceCommit: manifest.sourceCommit,
  easBuildId: manifest.easBuildId,
  buildFingerprint: manifest.buildFingerprint,
  limitations: [
    'Validated media is emulated-device evidence from an iOS Simulator.',
    'Package validation does not prove physical-device behavior, a completed sandbox purchase, App Store Connect upload, review, or acceptance.',
  ],
  assets: Object.values(requiredFiles).map((filename) => {
    const filePath = path.join(evidenceDirectory, filename);
    return { filename, bytes: fs.statSync(filePath).size, sha256: sha256(filePath) };
  }),
};
const validationPath = path.join(evidenceDirectory, 'review-evidence-manifest.json');
fs.writeFileSync(validationPath, `${JSON.stringify(validation, null, 2)}\n`);
console.log(`Emulated-device App Review package passed: ${validationPath}`);
