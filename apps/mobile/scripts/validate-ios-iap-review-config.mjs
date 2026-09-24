import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultMobileRoot = path.resolve(scriptDirectory, '..');

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  assert.ok(process.argv[index + 1], `${name} requires a value.`);
  return process.argv[index + 1];
}

const mobileRoot = path.resolve(argumentValue('--mobile-root') ?? defaultMobileRoot);
const repositoryRoot = path.resolve(mobileRoot, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(mobileRoot, relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(read(relativePath));

const app = readJson('app.json').expo;
const eas = readJson('eas.json');
const contract = readJson('store-assets/ios/subscription-review-contract.json');
const evidence = readJson('store-assets/ios/review-evidence-status.json');
const notes = read('store-assets/ios/review-notes-draft.md');
const listing = read('store-assets/ios/listing.md');
const shotList = read('store-assets/ios/review-evidence-shot-list.md');
const billing = read('src/screens/BillingScreen.tsx');
const bootstrap = read('src/components/PurchaseBootstrap.tsx');
const appConfig = read('app.config.js');
const nativeBilling = fs.readFileSync(path.join(repositoryRoot, 'docs', 'NATIVE_BILLING.md'), 'utf8');
const infrastructure = fs.readFileSync(path.join(repositoryRoot, 'infrastructure', 'kall-production.yaml'), 'utf8');

assert.equal(contract.evidenceScope, 'source-contract-only');
assert.equal(contract.appVersion, app.version, 'IAP review contract version must match app.json.');
assert.match(app.ios?.buildNumber ?? '', /^[1-9]\d*$/, 'The local iOS build seed must remain valid.');
assert.equal(contract.appVersion, evidence.appVersion, 'IAP review contract version must match evidence status.');
assert.equal(
  contract.appBuildVersion,
  evidence.appBuildVersion,
  'IAP review contract build must match the directly inspected submitted-build status, not the local EAS build seed.',
);
assert.equal(contract.bundleIdentifier, app.ios?.bundleIdentifier, 'IAP review bundle ID must match app.json.');
assert.equal(contract.offeringIdentifier, 'default', 'Kall review builds use the published default offering.');

assert.deepEqual(contract.products.map((product) => product.plan), ['plus', 'premium']);
assert.deepEqual(contract.products.map((product) => product.entitlementIdentifier), ['plus', 'premium']);
assert.deepEqual(contract.products.map((product) => product.packageIdentifier), ['plus', 'premium']);
assert.deepEqual(contract.products.map((product) => product.displayName), ['Kall Plus', 'Kall Premium']);
assert.ok(contract.products.every((product) => product.billingPeriod === 'monthly'));

const expectedProductIds = [
  'com.skaldandstone.kall.plus.monthly',
  'com.skaldandstone.kall.premium.monthly',
];
const productIds = contract.products.map((product) => product.appleProductIdentifier);
assert.deepEqual(productIds, expectedProductIds, 'Apple product identifiers changed.');
assert.equal(new Set(productIds).size, productIds.length, 'Apple product identifiers must be unique.');
for (const productId of productIds) {
  assert.ok(nativeBilling.includes(`\`${productId}\``), `Native billing documentation is missing ${productId}.`);
}

assert.equal(eas.build?.production?.env?.KALL_MOBILE_PURCHASES_ENABLED, '1');
assert.ok(appConfig.includes('EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY'));
assert.ok(appConfig.includes("buildPlatform === 'ios'"));
assert.doesNotMatch(appConfig, /REVENUECAT_(?:SECRET|WEBHOOK)/, 'Server RevenueCat secrets cannot enter the app config.');

assert.ok(bootstrap.includes('Purchases.configure({ apiKey, appUserID: userId })'));
assert.ok(bootstrap.includes('Purchases.logIn(userId)'));
assert.ok(bootstrap.includes('Purchases.invalidateCustomerInfoCache()'));
assert.ok(billing.includes('item.product.priceString'), 'The Plan screen must render the localized store price.');
assert.ok(billing.includes('Purchases.purchasePackage(aPackage)'));
assert.ok(billing.includes('Purchases.restorePurchases()'));
assert.doesNotMatch(billing, /https?:\/\//, 'Native billing cannot link to an external checkout.');
assert.doesNotMatch(billing, /(?:\$|USD\s*)(?:9|25)(?:\.00)?\b/, 'Native billing cannot hard-code US prices.');

for (const parameter of ['RevenueCatApplePlusProductId', 'RevenueCatApplePremiumProductId']) {
  assert.ok(infrastructure.includes(`${parameter}:`), `Infrastructure is missing ${parameter}.`);
  assert.ok(infrastructure.includes(`Value: !Ref ${parameter}`), `API task is not receiving ${parameter}.`);
}
assert.ok(infrastructure.includes("AllowedValues: [PRODUCTION, 'PRODUCTION,SANDBOX']"));

assert.equal(
  contract.reviewEvidence.appReviewRecordingRequired,
  !evidence.appReviewAttachmentPresent,
  'Recording requirement must match the directly inspected attachment status.',
);
assert.equal(
  contract.reviewEvidence.plusScreenshotRequired,
  !evidence.plusReviewScreenshotPresent,
  'Plus screenshot requirement must match the directly inspected provider status.',
);
assert.equal(
  contract.reviewEvidence.premiumScreenshotRequired,
  !evidence.premiumReviewScreenshotPresent,
  'Premium screenshot requirement must match the directly inspected provider status.',
);
assert.match(notes, /localized prices/i);
assert.match(notes, /Apple's sandbox/i);
assert.match(listing, /separate Plus and Premium subscription-review screenshots/i);
assert.match(shotList, /existing product identifiers/i);
assert.match(shotList, /localized App Store price/i);
assert.ok(contract.limitations.some((value) => /does not prove RevenueCat or App Store Connect state/i.test(value)));
assert.ok(contract.limitations.some((value) => /does not prove a sandbox purchase, upload, review, or acceptance/i.test(value)));

console.log('iOS IAP review source contract passed.');
console.log(`version=${contract.appVersion} build=${contract.appBuildVersion} offering=${contract.offeringIdentifier}`);
console.log(`products=${productIds.join(',')}`);
console.log('scope=source-only; provider, purchase, upload, and acceptance remain unproven');
