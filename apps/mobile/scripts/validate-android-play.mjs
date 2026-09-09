import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptDirectory, '..');
const app = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'app.json'), 'utf8')).expo;
const eas = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'eas.json'), 'utf8'));

const expectedPackage = 'com.skaldandstone.kall';
const expectedApiBase = 'https://kall.skaldandstone.com/api';
const retiredHost = ['d1ch3en4uvduym', 'cloudfront', 'net'].join('.');
const profileName = 'android-production';

assert.equal(app.android?.package, expectedPackage, 'Unexpected Android package name.');
// The package name is permanent the moment a Play Console listing exists for
// it -- see docs/NEEDS_DECISION.md -- so this is the one field on this
// screen worth a hard assertion rather than a passive default.
assert.match(String(app.android?.versionCode ?? ''), /^[1-9]\d*$/, 'Android versionCode must be a positive integer.');
assert.ok(
  app.android.versionCode >= 3,
  'Android versionCode baseline must not fall below the highest version already accepted by Play.',
);

for (const key of ['foregroundImage', 'backgroundImage', 'monochromeImage']) {
  const iconPath = path.join(mobileRoot, app.android?.adaptiveIcon?.[key] ?? '');
  const icon = fs.readFileSync(iconPath);
  assert.deepEqual(
    [...icon.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    `Android adaptiveIcon.${key} must be a PNG.`,
  );
}

const profile = eas.build?.[profileName];
assert.ok(profile, `Missing EAS profile ${profileName}.`);
assert.equal(profile.distribution, 'store', `${profileName} must be a "store" build -- Play Console tracks (Internal/Closed/Open/Production) are chosen at upload time, not by EAS's distribution field.`);
assert.equal(profile.android?.buildType, 'app-bundle', `${profileName} must build an .aab; Play rejects APKs for new app submissions.`);
assert.equal(profile.env?.KALL_MOBILE_RELEASE, '1', `${profileName} must enable release safeguards.`);
assert.equal(profile.environment, 'production', `${profileName} must load the EAS production environment.`);
assert.equal(profile.env?.API_BASE_URL, expectedApiBase, `${profileName} has the wrong API base.`);
assert.match(
  profile.env?.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '',
  /^pk_live_\S+$/,
  `${profileName} must use the production Clerk publishable key -- the same instance the web app signs into.`,
);
// The load-bearing invariant this build depends on: the local alpha-APK
// signing plugin must never apply to an EAS cloud build. See app.config.js
// and README.md's "Building for Google Play" section for why.
assert.notEqual(
  profile.env?.KALL_MOBILE_LOCAL_ANDROID_SIGNING,
  '1',
  `${profileName} must not set KALL_MOBILE_LOCAL_ANDROID_SIGNING -- EAS has no access to the local alpha keystore this would require.`,
);

assert.equal(
  eas.submit?.production?.android?.track,
  'alpha',
  'The production submit profile must automatically target the selected Play closed Alpha track.',
);
assert.equal(
  eas.submit?.['internal-qa']?.android?.track,
  'internal',
  'The internal-qa submit profile must preserve the explicit Play internal testing path.',
);
for (const submitProfileName of ['production', 'internal-qa']) {
  assert.equal(
    eas.submit?.[submitProfileName]?.android?.releaseStatus,
    'completed',
    `${submitProfileName} must publish a completed Play test release.`,
  );
}

const releaseEnvironment = profile.env;
const previousEnvironment = Object.fromEntries(
  [...Object.keys(releaseEnvironment), 'EXPO_PUBLIC_SENTRY_DSN'].map((name) => [name, process.env[name]]),
);
Object.assign(process.env, releaseEnvironment);
process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://0123456789abcdef0123456789abcdef@o123456.ingest.us.sentry.io/123456';
delete process.env.KALL_MOBILE_LOCAL_ANDROID_SIGNING;
let resolvedReleaseConfig;
try {
  const configModule = await import(pathToFileURL(path.join(mobileRoot, 'app.config.js')).href);
  resolvedReleaseConfig = configModule.default({ config: structuredClone(app) });
  assert.equal(resolvedReleaseConfig.extra?.sentryDsn, process.env.EXPO_PUBLIC_SENTRY_DSN, 'Resolved release Sentry DSN is wrong.');
} finally {
  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
assert.equal(resolvedReleaseConfig.extra?.apiBaseUrl, expectedApiBase, 'Resolved release API base is wrong.');
assert.equal(resolvedReleaseConfig.extra?.allowRegistration, true, 'Release registration must be open, matching the web app.');
assert.equal(resolvedReleaseConfig.android?.package, expectedPackage, 'Resolved release package name changed.');
assert.ok(
  !(resolvedReleaseConfig.plugins ?? []).includes('./plugins/with-release-signing'),
  'The local alpha-APK signing plugin must not be applied to the resolved Play build config -- it would fail Gradle with a missing keystore that only exists on the machine running build-alpha-apk.ps1.',
);

const appSource = fs.readFileSync(path.join(mobileRoot, 'App.tsx'), 'utf8');
const socialSource = fs.readFileSync(
  path.join(mobileRoot, 'src', 'components', 'SocialSignInButtons.tsx'),
  'utf8',
);
const purchaseBootstrapSource = fs.readFileSync(
  path.join(mobileRoot, 'src', 'components', 'PurchaseBootstrap.tsx'),
  'utf8',
);
const billingSource = fs.readFileSync(
  path.join(mobileRoot, 'src', 'screens', 'BillingScreen.tsx'),
  'utf8',
);
const updateSource = fs.readFileSync(
  path.join(mobileRoot, 'src', 'components', 'UpdatePrompt.tsx'),
  'utf8',
);
const releaseResetSource = fs.readFileSync(
  path.join(mobileRoot, 'src', 'components', 'ReleaseResetGate.tsx'),
  'utf8',
);
const releaseRouteSource = fs.readFileSync(
  path.join(mobileRoot, '..', 'web', 'app', 'api', 'mobile-release', 'route.ts'),
  'utf8',
);
const backendReleaseSource = fs.readFileSync(
  path.join(mobileRoot, '..', '..', 'backend', 'kall', 'api_ops.py'),
  'utf8',
);
assert.ok(
  appSource.includes('WebBrowser.maybeCompleteAuthSession()'),
  'App must complete the Clerk browser handoff after Google redirects back.',
);
assert.ok(
  socialSource.includes("strategy: 'oauth_google'"),
  'Android release must offer the Google provider enabled in production Clerk.',
);
assert.ok(
  socialSource.includes("scheme: 'kall'") &&
    socialSource.includes("path: 'sso-callback'") &&
    socialSource.includes('redirectUrl: googleRedirectUrl'),
  'Google SSO must use the exact native callback registered in production Clerk.',
);
assert.ok(
  socialSource.includes("strategy: 'oauth_apple'") &&
    socialSource.includes("Platform.OS === 'ios'") &&
    socialSource.includes('appleSignInEnabled'),
  'Apple sign-in must remain iOS-only and gated by explicit production provider configuration.',
);
assert.ok(
  appSource.includes('PurchaseBootstrap'),
  'The release must initialize native purchases inside the authenticated Clerk boundary.',
);
assert.ok(
  appSource.includes("Sentry.init({") &&
    appSource.includes("sendDefaultPii: false") &&
    appSource.includes("export default Sentry.wrap(App)"),
  'The release must initialize Sentry without default PII and wrap the mobile app.',
);
const clientSource = fs.readFileSync(
  path.join(mobileRoot, 'src', 'api', 'client.ts'),
  'utf8',
);
assert.ok(
  clientSource.includes('new File(file.uri)') &&
    clientSource.includes('nativeFile.bytes()') &&
    clientSource.includes('new Blob([bytes], { type: file.type })'),
  'Native uploads must convert document-provider URIs into a real typed Blob.',
);
assert.ok(
  purchaseBootstrapSource.includes('appUserID: userId') &&
    purchaseBootstrapSource.includes('Purchases.logIn(userId)'),
  'Native purchases must use the authenticated Clerk user ID across devices and stores.',
);
assert.ok(
  billingSource.includes('Purchases.purchasePackage') &&
    billingSource.includes('Purchases.restorePurchases()'),
  'The mobile billing screen must support store purchase and explicit restore flows.',
);
assert.ok(
  updateSource.includes('/mobile-release'),
  'Android must check the public mobile release manifest when the app loads.',
);
assert.ok(
  updateSource.includes('https://play.google.com/apps/testing/com.skaldandstone.kall'),
  'The update prompt must use the account-aware Play testing page.',
);
assert.ok(
  updateSource.includes("Platform.OS !== 'android'"),
  'The Play update prompt must never appear on iOS or web builds.',
);
assert.ok(
  updateSource.includes('if (!response.ok) return;') && updateSource.includes('catch'),
  'An unavailable release check must fail open without blocking the app.',
);
assert.ok(
  appSource.includes('ReleaseResetGate') &&
    releaseResetSource.includes('Application.nativeApplicationVersion') &&
    releaseResetSource.includes('Application.nativeBuildVersion') &&
    releaseResetSource.includes('await clerk.signOut()') &&
    releaseResetSource.includes('await clearSessionTokenCache()') &&
    releaseResetSource.includes('await resetPurchaseSession()'),
  'A changed native release must clear app-owned billing state and require a fresh Clerk login.',
);
const latestVersionMatch = releaseRouteSource.match(/latestAndroidVersion = '(\d+\.\d+\.\d+)'/);
assert.equal(
  latestVersionMatch?.[1],
  app.version,
  'The public Android release manifest must match the app version being built.',
);
const backendLatestVersionMatch = backendReleaseSource.match(/LATEST_ANDROID_VERSION = "(\d+\.\d+\.\d+)"/);
assert.equal(
  backendLatestVersionMatch?.[1],
  app.version,
  'The production API Android release manifest must match the app version being built.',
);

for (const relativePath of ['app.json', 'app.config.js', 'eas.json']) {
  const contents = fs.readFileSync(path.join(mobileRoot, relativePath), 'utf8');
  assert.ok(!contents.includes(retiredHost), `${relativePath} still references the retired CloudFront host.`);
}

console.log('Android Play configuration passed.');
console.log(`package=${app.android.package}`);
console.log(`versionCode=${app.android.versionCode}`);
console.log(`apiBaseUrl=${expectedApiBase}`);
console.log('registration=open, production Clerk instance, EAS-managed signing');
