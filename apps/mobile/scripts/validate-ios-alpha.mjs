import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptDirectory, '..');
const app = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'app.json'), 'utf8')).expo;
const eas = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'eas.json'), 'utf8'));

const expectedBundleIdentifier = 'com.skaldandstone.kall';
const expectedApiBase = 'https://kall.skaldandstone.com/api';
const retiredHost = ['d1ch3en4uvduym', 'cloudfront', 'net'].join('.');

assert.equal(app.ios?.bundleIdentifier, expectedBundleIdentifier, 'Unexpected iOS bundle identifier.');
assert.match(app.ios?.buildNumber ?? '', /^[1-9]\d*$/, 'iOS buildNumber must be a positive integer string.');
assert.equal(
  app.ios?.config?.usesNonExemptEncryption,
  false,
  'The alpha must declare that it only uses exempt encryption such as HTTPS and platform keychain APIs.',
);

const iconPath = path.join(mobileRoot, app.icon);
const icon = fs.readFileSync(iconPath);
assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'iOS icon must be a PNG.');
assert.equal(icon.readUInt32BE(16), 1024, 'iOS icon must be 1024 pixels wide.');
assert.equal(icon.readUInt32BE(20), 1024, 'iOS icon must be 1024 pixels high.');
assert.ok(![4, 6].includes(icon[25]), 'iOS App Store icon cannot contain an alpha channel.');

for (const [profileName, simulator] of [
  ['ios-simulator-alpha', true],
  ['ios-device-alpha', false],
]) {
  const profile = eas.build?.[profileName];
  assert.ok(profile, `Missing EAS profile ${profileName}.`);
  assert.equal(profile.distribution, 'internal', `${profileName} must remain an internal build.`);
  assert.equal(profile.ios?.simulator, simulator, `${profileName} has the wrong simulator target.`);
  assert.equal(profile.ios?.buildConfiguration, 'Release', `${profileName} must compile the Release configuration.`);
  assert.equal(profile.env?.KALL_MOBILE_RELEASE, '1', `${profileName} must enable release safeguards.`);
  assert.equal(profile.env?.API_BASE_URL, expectedApiBase, `${profileName} has the wrong API base.`);
  assert.match(
    profile.env?.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '',
    /^pk_live_\S+$/,
    `${profileName} must use the production Clerk publishable key.`,
  );
}

const releaseEnvironment = eas.build['ios-simulator-alpha'].env;
const previousEnvironment = Object.fromEntries(
  Object.keys(releaseEnvironment).map((name) => [name, process.env[name]]),
);
Object.assign(process.env, releaseEnvironment);
let resolvedReleaseConfig;
try {
  const configModule = await import(pathToFileURL(path.join(mobileRoot, 'app.config.js')).href);
  resolvedReleaseConfig = configModule.default({ config: structuredClone(app) });
} finally {
  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
assert.equal(resolvedReleaseConfig.extra?.apiBaseUrl, expectedApiBase, 'Resolved release API base is wrong.');
assert.equal(resolvedReleaseConfig.extra?.allowRegistration, false, 'Release registration must remain invite-only.');
assert.equal(
  resolvedReleaseConfig.ios?.bundleIdentifier,
  expectedBundleIdentifier,
  'Resolved release bundle identifier changed.',
);
assert.equal(resolvedReleaseConfig.ios?.buildNumber, app.ios.buildNumber, 'Resolved release build number changed.');

for (const relativePath of ['app.json', 'app.config.js', 'eas.json']) {
  const contents = fs.readFileSync(path.join(mobileRoot, relativePath), 'utf8');
  assert.ok(!contents.includes(retiredHost), `${relativePath} still references the retired CloudFront host.`);
}

console.log('iOS alpha configuration passed.');
console.log(`bundleIdentifier=${app.ios.bundleIdentifier}`);
console.log(`buildNumber=${app.ios.buildNumber}`);
console.log(`apiBaseUrl=${expectedApiBase}`);
console.log('registration=invite-only release safeguard');
