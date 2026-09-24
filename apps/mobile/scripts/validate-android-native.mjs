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
assert.equal(
  application.$['android:allowBackup'],
  'false',
  'Release builds must not back up app data, authentication state, or cached private files.',
);
assert.equal(
  application.$['android:usesCleartextTraffic'],
  'false',
  'Release builds must reject cleartext HTTP traffic.',
);
assert.notEqual(
  application.$['android:debuggable'],
  'true',
  'Release configuration must not mark the application debuggable.',
);

const permissionEntries = android.manifest.manifest['uses-permission'] ?? [];
for (const permission of [
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.SYSTEM_ALERT_WINDOW',
]) {
  const entries = permissionEntries.filter(
    (entry) => entry.$?.['android:name'] === permission,
  );
  assert.ok(entries.length > 0, `Generated Android manifest is missing the removal rule for ${permission}.`);
  assert.ok(
    entries.every((entry) => entry.$?.['tools:node'] === 'remove'),
    `Generated Android manifest must remove ${permission} during manifest merge.`,
  );
}

const mainActivity = application.activity.find(
  (activity) => activity.$['android:name'] === '.MainActivity',
);
assert.ok(mainActivity, 'Generated Android manifest is missing MainActivity.');
assert.equal(
  mainActivity.$['android:exported'],
  'true',
  'MainActivity must remain exported for launcher and verified authentication deep links.',
);

for (const componentType of ['activity', 'activity-alias', 'service', 'receiver', 'provider']) {
  for (const component of application[componentType] ?? []) {
    if (component.$?.['android:exported'] !== 'true') continue;
    assert.equal(
      component.$?.['android:name'],
      '.MainActivity',
      `Only MainActivity may be explicitly exported; found exported ${componentType} ${component.$?.['android:name'] ?? '<unnamed>'}.`,
    );
  }
}
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
console.log('backup=false, cleartext=false, broad-storage=false, overlay=false');
console.log('resizable=true, edge-to-edge=true, R8=true, resource-shrinking=true');
