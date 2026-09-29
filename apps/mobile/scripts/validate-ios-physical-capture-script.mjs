import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptDirectory, '..');
const read = (relativePath) => fs.readFileSync(path.join(mobileRoot, relativePath), 'utf8');
const contract = JSON.parse(read('store-assets/ios/subscription-review-contract.json'));
const app = JSON.parse(read('app.json')).expo;
const runbook = read('store-assets/ios/physical-review-capture-script.md');
const notes = read('store-assets/ios/review-notes-draft.md');
const navigation = read('src/navigation/RootNavigator.tsx');
const login = read('src/screens/LoginScreen.tsx');
const trackSwitch = read('src/components/OpportunityTrackSwitch.tsx');
const workspace = read('src/screens/WorkspaceScreen.tsx');
const billing = read('src/screens/BillingScreen.tsx');
const deletion = read('src/screens/DeleteAccountScreen.tsx');

assert.equal(contract.appVersion, app.version);
assert.match(runbook, new RegExp(`Kall ${contract.appVersion} \\(${contract.appBuildVersion}\\)`));

for (const label of ['Today', 'Work', 'Apply', 'Growth', 'Profile']) {
  assert.ok(navigation.includes(`title: "${label}"`), `Navigation is missing ${label}.`);
  assert.match(runbook, new RegExp(`\\*\\*${label}\\*\\*`), `Runbook is missing ${label}.`);
}
for (const label of ['Welcome back', 'Sign in', 'Confirm this device', 'Verification code', 'Verify device']) {
  assert.ok(login.includes(label), `Login source is missing ${label}.`);
  assert.ok(runbook.includes(label), `Runbook is missing login state ${label}.`);
}
for (const label of ['Job search', 'Consulting']) {
  assert.ok(trackSwitch.includes(`label="${label}"`), `Track switch is missing ${label}.`);
  assert.match(runbook, new RegExp(`\\*\\*${label}\\*\\*`), `Runbook is missing work track ${label}.`);
}

assert.ok(workspace.includes('title: "Plan and billing"'));
assert.ok(workspace.includes('>Delete my account</Text>'));
assert.match(runbook, /Profile > Plan and billing/);
assert.match(notes, /Profile.+Plan and billing/is);

assert.ok(billing.includes('item.product.title'));
assert.ok(billing.includes('item.product.priceString'));
assert.ok(billing.includes('Purchases.purchasePackage(aPackage)'));
assert.ok(billing.includes('Purchases.restorePurchases()'));
assert.ok(billing.includes('Restore purchases'));
assert.doesNotMatch(billing, /https?:\/\//, 'Native billing cannot link to an external checkout.');
assert.match(runbook, /Restore purchases/);
assert.match(runbook, /localized monthly App Store price/);

for (const product of contract.products) {
  assert.ok(runbook.includes(product.displayName), `Runbook is missing ${product.displayName}.`);
  assert.ok(runbook.includes(product.appleProductIdentifier), `Runbook is missing ${product.appleProductIdentifier}.`);
  assert.match(runbook, new RegExp(`Choose ${product.displayName}`), `Runbook is missing the ${product.plan} purchase action.`);
}

for (const label of ['This cannot be undone', 'Permanently delete my account']) {
  assert.ok(deletion.includes(label), `Deletion source is missing ${label}.`);
  assert.ok(runbook.includes(label), `Runbook is missing deletion state ${label}.`);
}
assert.match(runbook, /Do not type the confirmation email/);
assert.match(runbook, /do not delete the account/i);
assert.match(runbook, /Do not complete a purchase/i);
assert.match(runbook, /Do not approve or submit anything/i);
assert.match(runbook, /Do not resize an unsupported raw capture/i);
assert.match(runbook, /does not prove TestFlight installation, successful sign-in, a\s+sandbox purchase, App Store Connect upload, review, or acceptance/i);

console.log('iOS physical-capture runbook source validation passed.');
console.log(`version=${contract.appVersion} build=${contract.appBuildVersion}`);
console.log(`products=${contract.products.map((product) => product.appleProductIdentifier).join(',')}`);
console.log('scope=source labels and routes only; device, provider, purchase, upload, and acceptance remain unproven');
