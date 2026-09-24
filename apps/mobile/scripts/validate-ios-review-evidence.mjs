import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptDirectory, '..');
const iosAssets = path.join(mobileRoot, 'store-assets', 'ios');
const status = JSON.parse(fs.readFileSync(path.join(iosAssets, 'review-evidence-status.json'), 'utf8'));
const contract = JSON.parse(fs.readFileSync(path.join(iosAssets, 'subscription-review-contract.json'), 'utf8'));
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
assert.match(listing, /Simulator media is internal QA\s+evidence/i);
assert.match(notes, /Simulator captures are internal QA evidence only/i);
assert.match(shotList, /Do not\s+substitute responsive web or\s+iOS Simulator media for the physical-device\s+recording/i);

const evidenceArg = process.argv.indexOf('--evidence-dir');
if (evidenceArg === -1) {
  console.log('iOS App Review source preflight passed.');
  console.log(`attachment=${status.appReviewAttachmentPresent}, plus=${status.plusReviewScreenshotPresent}, premium=${status.premiumReviewScreenshotPresent}`);
  process.exit(0);
}
const evidenceValue = process.argv[evidenceArg + 1];
assert.ok(evidenceValue, '--evidence-dir requires a directory path.');
const evidenceDirectory = path.resolve(process.cwd(), evidenceValue);
assert.ok(fs.statSync(evidenceDirectory).isDirectory(), 'Evidence path must be a directory.');
const requiredFiles = {
  video: 'kall-ios-physical-review.mp4',
  plus: 'plus-subscription-review.png',
  premium: 'premium-subscription-review.png',
  metadata: 'capture-metadata.json',
};
for (const filename of Object.values(requiredFiles)) {
  assert.ok(fs.existsSync(path.join(evidenceDirectory, filename)), `Missing ${filename}.`);
}
const metadata = JSON.parse(fs.readFileSync(path.join(evidenceDirectory, requiredFiles.metadata), 'utf8'));
assert.equal(metadata.captureType, 'physical-device', 'Simulator capture metadata is not accepted.');
assert.doesNotMatch(metadata.deviceModel ?? '', /simulator/i, 'Device model cannot identify a simulator.');
assert.match(metadata.deviceModel ?? '', /\S/, 'A physical iPhone model is required.');
assert.match(metadata.iosVersion ?? '', /\S/, 'The physical-device iOS version is required.');
assert.equal(metadata.appVersion, status.appVersion, 'Capture app version does not match the submitted version.');
assert.equal(metadata.appBuildVersion, status.appBuildVersion, 'Capture build does not match the submitted build.');
assert.match(metadata.sourceCommit ?? '', /^[a-f0-9]{40}$/i, 'Capture sourceCommit must be a full Git SHA.');
assert.ok(!Number.isNaN(Date.parse(metadata.capturedAt)), 'capturedAt must be an ISO-8601 timestamp.');
for (const [field, expected] of [
  ['oneContinuousTake', true],
  ['credentialsVisible', false],
  ['purchaseCompleted', false],
  ['accountDeleted', false],
  ['reviewedByOwner', true],
]) assert.equal(metadata[field], expected, `${field} must be ${expected}.`);

const productsByPlan = new Map(contract.products.map((product) => [product.plan, product]));
const screenshotReviews = metadata.subscriptionScreenshots;
assert.equal(typeof screenshotReviews, 'object', 'subscriptionScreenshots review metadata is required.');
assert.deepEqual(Object.keys(screenshotReviews ?? {}).sort(), ['plus', 'premium'], 'subscriptionScreenshots must contain exactly plus and premium.');
for (const [plan, filename] of [['plus', requiredFiles.plus], ['premium', requiredFiles.premium]]) {
  const product = productsByPlan.get(plan);
  assert.ok(product, `The IAP contract must define ${plan}.`);
  const review = screenshotReviews?.[plan];
  assert.equal(typeof review, 'object', `${plan} screenshot review metadata is required.`);
  assert.deepEqual(
    Object.keys(review ?? {}).sort(),
    [
      'accountDetailsVisible',
      'appleProductIdentifier',
      'captureSurface',
      'displayNameVisible',
      'filename',
      'localizedPriceVisible',
      'nativePurchaseActionVisible',
      'surroundingKallUiVisible',
      'visuallyReviewedByOwner',
    ],
    `${plan} screenshot review metadata contains unsupported fields.`,
  );
  assert.equal(review.filename, filename, `${plan} screenshot filename must be ${filename}.`);
  assert.equal(review.captureSurface, 'native-app', `${plan} screenshot must be captured from the native app.`);
  assert.equal(review.appleProductIdentifier, product.appleProductIdentifier, `${plan} screenshot product ID must match the IAP contract.`);
  assert.equal(review.displayNameVisible, product.displayName, `${plan} screenshot must show ${product.displayName}.`);
  for (const field of ['localizedPriceVisible', 'nativePurchaseActionVisible', 'surroundingKallUiVisible', 'visuallyReviewedByOwner']) {
    assert.equal(review[field], true, `${plan}.${field} must be true.`);
  }
  assert.equal(review.accountDetailsVisible, false, `${plan}.accountDetailsVisible must be false.`);
}

const allowedIphoneDimensions = new Set(['1179x2556', '1242x2688', '1284x2778', '1290x2796', '1320x2868']);
function pngDimensions(filePath) {
  const bytes = fs.readFileSync(filePath);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${path.basename(filePath)} must be a PNG.`);
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}
for (const screenshotName of [requiredFiles.plus, requiredFiles.premium]) {
  const dimensions = pngDimensions(path.join(evidenceDirectory, screenshotName));
  assert.ok(allowedIphoneDimensions.has(dimensions), `${screenshotName} has unsupported dimensions ${dimensions}.`);
}
function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
const plusHash = sha256(path.join(evidenceDirectory, requiredFiles.plus));
const premiumHash = sha256(path.join(evidenceDirectory, requiredFiles.premium));
assert.notEqual(plusHash, premiumHash, 'Plus and Premium review screenshots must be distinct images.');
const listingScreenshotHashes = new Set(
  ['iphone', 'ipad'].flatMap((deviceClass) =>
    fs.readdirSync(path.join(iosAssets, 'screenshots', deviceClass))
      .filter((filename) => filename.endsWith('.png'))
      .map((filename) => sha256(path.join(iosAssets, 'screenshots', deviceClass, filename))),
  ),
);
assert.ok(!listingScreenshotHashes.has(plusHash), 'Plus review screenshot cannot reuse public listing artwork.');
assert.ok(!listingScreenshotHashes.has(premiumHash), 'Premium review screenshot cannot reuse public listing artwork.');
const videoPath = path.join(evidenceDirectory, requiredFiles.video);
const video = fs.readFileSync(videoPath);
assert.ok(video.length >= 1024 * 1024, 'Physical-device review video is unexpectedly small.');
assert.equal(video.subarray(4, 8).toString('ascii'), 'ftyp', 'Review video must be an MP4 container.');
const manifest = {
  captureType: metadata.captureType,
  deviceModel: metadata.deviceModel,
  iosVersion: metadata.iosVersion,
  appVersion: metadata.appVersion,
  appBuildVersion: metadata.appBuildVersion,
  sourceCommit: metadata.sourceCommit,
  capturedAt: metadata.capturedAt,
  limitations: ['Package validation does not prove App Store Connect upload or Apple acceptance.'],
  subscriptionScreenshots: Object.fromEntries(
    ['plus', 'premium'].map((plan) => {
      const review = screenshotReviews[plan];
      return [plan, {
        ...review,
        sha256: sha256(path.join(evidenceDirectory, review.filename)),
      }];
    }),
  ),
  assets: Object.values(requiredFiles).map((filename) => {
    const filePath = path.join(evidenceDirectory, filename);
    const bytes = fs.readFileSync(filePath);
    return { filename, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  }),
};
const manifestPath = path.join(evidenceDirectory, 'review-evidence-manifest.json');
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Physical-device App Review package passed: ${manifestPath}`);
