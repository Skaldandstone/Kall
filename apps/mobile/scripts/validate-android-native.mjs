import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mobileRoot = fileURLToPath(new URL('../', import.meta.url));
const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npx';
const commandArguments = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npx expo config --type introspect --json']
  : ['expo', 'config', '--type', 'introspect', '--json'];
const result = spawnSync(command, commandArguments, {
  cwd: mobileRoot,
  encoding: 'utf8',
  env: {
    ...process.env,
    API_BASE_URL: 'https://kall.skaldandstone.com/api',
    EXPO_PUBLIC_SENTRY_DSN:
      'https://0123456789abcdef0123456789abcdef@o123456.ingest.us.sentry.io/123456',
    KALL_MOBILE_RELEASE: '1',
  },
  shell: false,
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || 'Expo config introspection failed.\n');
  process.exit(result.status ?? 1);
}

const config = JSON.parse(result.stdout);
const android = config._internal?.modResults?.android;
assert.ok(android, 'Expo did not produce Android native configuration.');

const application = android.manifest.manifest.application[0];
const mainActivity = application.activity.find(
  (activity) => activity.$['android:name'] === '.MainActivity',
);
assert.ok(mainActivity, 'Generated Android manifest is missing MainActivity.');
assert.ok(
  !['portrait', 'landscape', 'sensorPortrait', 'sensorLandscape'].includes(
    mainActivity.$['android:screenOrientation'],
  ),
  'MainActivity must not restrict orientation on large screens.',
);
assert.notEqual(
  mainActivity.$['android:resizeableActivity'],
  'false',
  'MainActivity must remain resizable.',
);
assert.notEqual(
  application.$['android:resizeableActivity'],
  'false',
  'The Android application must remain resizable.',
);

const features = android.manifest.manifest['uses-feature'] ?? [];
assert.ok(
  features.every((feature) => feature.$?.['android:name'] !== 'android.hardware.screen.portrait'),
  'The generated bundle must not require a portrait-only screen.',
);

const gradle = Object.fromEntries(
  android.gradleProperties
    .filter((entry) => entry.type === 'property')
    .map((entry) => [entry.key, entry.value]),
);
assert.equal(gradle.edgeToEdgeEnabled, 'true', 'Android edge-to-edge support must remain enabled.');
assert.equal(
  gradle['android.enableMinifyInReleaseBuilds'],
  'true',
  'Release code shrinking must remain enabled.',
);
assert.equal(
  gradle['android.enableShrinkResourcesInReleaseBuilds'],
  'true',
  'Release resource shrinking must remain enabled.',
);
assert.equal(
  gradle['android.enablePngCrunchInReleaseBuilds'],
  'true',
  'Release PNG optimization must remain enabled.',
);

console.log('Generated Android configuration passed.');
console.log(`orientation=${mainActivity.$['android:screenOrientation'] ?? 'not-set'}`);
console.log('resizable=true, edge-to-edge=true, R8=true, resource-shrinking=true');
