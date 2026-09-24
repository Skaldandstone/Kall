import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const evidenceArg = process.argv.indexOf('--evidence-dir');
assert.notEqual(evidenceArg, -1, '--evidence-dir is required.');
const evidenceValue = process.argv[evidenceArg + 1];
assert.ok(evidenceValue, '--evidence-dir requires a directory path.');

const evidenceDirectory = path.resolve(process.cwd(), evidenceValue);
assert.ok(fs.existsSync(evidenceDirectory), 'Simulator evidence directory does not exist.');
assert.ok(fs.statSync(evidenceDirectory).isDirectory(), 'Simulator evidence path must be a directory.');

const requiredFiles = {
  screenshot: '01-kall-sign-in.png',
  recording: 'kall-ios-review-flow.mp4',
  manifest: 'manifest.json',
};
for (const filename of Object.values(requiredFiles)) {
  assert.ok(fs.existsSync(path.join(evidenceDirectory, filename)), `Missing ${filename}.`);
}

const manifestPath = path.join(evidenceDirectory, requiredFiles.manifest);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.captureType, 'iOS Simulator', 'Capture must be identified as iOS Simulator evidence.');
assert.equal(manifest.appVersion, '1.2.0', 'Simulator capture must use submitted app version 1.2.0.');
assert.equal(manifest.appBuildVersion, '21', 'Simulator capture must use submitted build 21.');
assert.match(manifest.sourceCommit ?? '', /^[a-f0-9]{40}$/i, 'sourceCommit must be a full Git SHA.');
assert.match(manifest.easBuildId ?? '', /^[a-f0-9-]{36}$/i, 'easBuildId must identify the reused EAS build.');
assert.match(manifest.buildFingerprint ?? '', /^[a-f0-9]{40}$/i, 'buildFingerprint must be a full fingerprint hash.');
assert.match(manifest.deviceType ?? '', /Simulator\.SimDeviceType\.iPhone/i, 'deviceType must identify an iPhone Simulator.');
assert.match(manifest.runtime ?? '', /Simulator\.SimRuntime\.iOS/i, 'runtime must identify an iOS Simulator runtime.');

const limitations = Array.isArray(manifest.limitations) ? manifest.limitations.join(' ') : '';
assert.match(limitations, /not physical-device evidence/i, 'Manifest must state that the capture is not physical-device evidence.');
assert.match(limitations, /signed-out sign-in rendering only/i, 'Manifest must limit the capture to signed-out sign-in rendering.');
assert.doesNotMatch(limitations, /proves? (?:authentication|purchase|restore|deletion)/i, 'Manifest cannot claim unsupported authenticated behavior.');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function pngDimensions(filePath) {
  const bytes = fs.readFileSync(filePath);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${path.basename(filePath)} must be a PNG.`);
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

function validateAsset(asset, expectedFile) {
  assert.equal(asset?.file, expectedFile, `Manifest must identify ${expectedFile}.`);
  const filePath = path.join(evidenceDirectory, expectedFile);
  const size = fs.statSync(filePath).size;
  assert.equal(asset.bytes, size, `${expectedFile} byte count does not match the artifact.`);
  assert.equal(asset.sha256, sha256(filePath), `${expectedFile} SHA-256 does not match the artifact.`);
}

const screenshotPath = path.join(evidenceDirectory, requiredFiles.screenshot);
const dimensions = pngDimensions(screenshotPath);
const allowedDimensions = new Set(['1284x2778', '1260x2736', '1290x2796', '1320x2868']);
assert.ok(allowedDimensions.has(dimensions), `Simulator screenshot has unsupported dimensions ${dimensions}.`);
assert.equal(manifest.screenshot?.dimensions, dimensions, 'Screenshot dimensions do not match the manifest.');
validateAsset(manifest.screenshot, requiredFiles.screenshot);

const recordingPath = path.join(evidenceDirectory, requiredFiles.recording);
const recording = fs.readFileSync(recordingPath);
assert.ok(recording.length >= 1024 * 1024, 'Simulator recording is unexpectedly small.');
assert.equal(recording.subarray(4, 8).toString('ascii'), 'ftyp', 'Simulator recording must be an MP4 container.');
validateAsset(manifest.recording, requiredFiles.recording);

const validation = {
  validatedAt: new Date().toISOString(),
  captureType: manifest.captureType,
  appVersion: manifest.appVersion,
  appBuildVersion: manifest.appBuildVersion,
  sourceCommit: manifest.sourceCommit,
  easBuildId: manifest.easBuildId,
  buildFingerprint: manifest.buildFingerprint,
  limitations: [
    'Validated simulator media proves native launch and signed-out sign-in rendering only.',
    'This validation does not prove physical-device behavior, authentication, purchases, App Store upload, or Apple acceptance.',
  ],
  assets: [requiredFiles.screenshot, requiredFiles.recording, requiredFiles.manifest].map((filename) => {
    const filePath = path.join(evidenceDirectory, filename);
    return { filename, bytes: fs.statSync(filePath).size, sha256: sha256(filePath) };
  }),
};
const validationPath = path.join(evidenceDirectory, 'simulator-evidence-validation.json');
fs.writeFileSync(validationPath, `${JSON.stringify(validation, null, 2)}\n`);
console.log(`iOS Simulator review package passed: ${validationPath}`);
