import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const [platform, ...flags] = process.argv.slice(2);
if (!['android', 'ios', 'all'].includes(platform) || flags.some(flag =>
  !['--non-interactive', '--no-wait', '--check'].includes(flag))) {
  console.error('Usage: node scripts/release-store.mjs android|ios|all [--non-interactive] [--no-wait] [--check]');
  process.exit(1);
}
const eas = JSON.parse(fs.readFileSync(new URL('../eas.json', import.meta.url)));
if (platform !== 'android' && !/^[1-9]\d*$/.test(eas.submit?.production?.ios?.ascAppId ?? '')) {
  console.error('iOS submission is pending Apple Developer enrollment. Create Kall in App Store Connect, set submit.production.ios.ascAppId in eas.json, and configure iOS signing and the EAS Submit API key with eas credentials --platform ios. No build was queued.');
  process.exit(1);
}
if (flags.includes('--check')) {
  console.log(`Local ${platform} submission configuration is ready; remote credentials are not checked.`);
  process.exit(0);
}
// Arguments are restricted above because Windows launches npx through cmd.exe.
const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
  '--yes', 'eas-cli@23.2.0', 'build', '--platform', platform,
  '--profile', 'production', '--auto-submit-with-profile', 'production', ...flags,
], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
