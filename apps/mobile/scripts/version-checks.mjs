import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The highest marketing version already handed to a store. App Store Connect
 * holds 1.2.0 (submission f5be984a, 2026-09-19), and a version string below
 * that cannot be uploaded again -- Apple rejects a build whose
 * CFBundleShortVersionString is not above the last one, and Play the same for
 * an app bundle. The repository once sat at 1.1.7 while 1.2.0 was under
 * review, which is exactly the drift this pins down: raise this constant when
 * a higher version is submitted, so the baseline always states the truth about
 * what the stores have seen.
 */
export const SUBMITTED_STORE_VERSION = '1.2.0';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function parse(version, label) {
  const match = SEMVER.exec(version ?? '');
  assert.ok(match, `${label} must be a three-part version like 1.2.0, not ${JSON.stringify(version)}.`);
  return match.slice(1, 4).map(Number);
}

/** Negative, zero, or positive, like a comparator. */
export function compareVersions(left, right) {
  const a = parse(left, 'version');
  const b = parse(right, 'version');
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * app.json is what a build stamps into the binary, and package.json is what a
 * developer reads; when they disagree, the version that reaches the store is
 * whichever one the build happened to use. Asserting both against the store
 * baseline keeps a release from silently shipping a version the stores have
 * already consumed.
 */
export function assertStoreVersions(mobileRoot) {
  const app = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'app.json'), 'utf8')).expo;
  const pkg = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'package.json'), 'utf8'));
  parse(app.version, 'app.json expo.version');
  assert.equal(
    pkg.version,
    app.version,
    `package.json version ${pkg.version} must match app.json ${app.version}; a build stamps app.json into the binary, so a mismatch ships an unexpected version.`,
  );
  assert.ok(
    compareVersions(app.version, SUBMITTED_STORE_VERSION) >= 0,
    `Mobile version ${app.version} is below ${SUBMITTED_STORE_VERSION}, already submitted to a store. Raise expo.version and package.json, or raise SUBMITTED_STORE_VERSION if this baseline is stale.`,
  );
  return app.version;
}
