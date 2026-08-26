import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchFields, normalize } from '../src/matcher.js';

/** Shorthand for a form control descriptor. */
function control(ref, signals = {}) {
  return { ref, ...signals };
}

/** Shorthand for a pack field. */
function packField(path, label, value, requiresConfirmation = false) {
  return { path, label, value, requires_confirmation: requiresConfirmation };
}

const NAME = packField('identity.legal_name', 'Full name', 'Ada Lovelace');
const EMAIL = packField('identity.email', 'Email', 'ada@example.com');
const PHONE = packField('identity.phone', 'Phone', '+1 512 555 0100');

test('normalize collapses the punctuation forms differ on', () => {
  assert.equal(normalize('First_Name'), 'first name');
  assert.equal(normalize('  E-Mail  Address* '), 'e mail address');
  assert.equal(normalize(null), '');
});

test('an autocomplete token wins outright', () => {
  // The label says something unhelpful; the declared semantics are believed.
  const form = [control('a', { autocomplete: 'email', label: 'Contact' })];
  const { fill } = matchFields([EMAIL], form);
  assert.deepEqual(fill.map((f) => [f.path, f.ref]), [['identity.email', 'a']]);
});

test('a plain labelled field is matched', () => {
  const form = [control('a', { label: 'Email Address' }), control('b', { label: 'Full Name' })];
  const { fill } = matchFields([NAME, EMAIL], form);
  assert.deepEqual(
    fill.map((f) => [f.path, f.ref]).sort(),
    [['identity.email', 'a'], ['identity.legal_name', 'b']],
  );
});

test('EEO and work authorization are proposed, never filled', () => {
  const eeo = packField('eeo.veteran_status', 'Veteran status', 'Not a veteran', true);
  const auth = packField('work_authorization.citizenship', 'Citizenship', 'US citizen', true);
  const form = [control('a', { label: 'Protected veteran status' }), control('b', { label: 'Citizenship' })];

  const { fill, confirm } = matchFields([eeo, auth], form);
  assert.deepEqual(fill, [], 'nothing requiring confirmation may be auto-filled');
  assert.deepEqual(confirm.map((f) => f.path).sort(), [
    'eeo.veteran_status',
    'work_authorization.citizenship',
  ]);
});

test('an unrecognised field is left alone rather than guessed at', () => {
  const form = [control('a', { label: 'How did you hear about us?' })];
  const { fill, confirm, unmatched } = matchFields([NAME, EMAIL], form);
  assert.deepEqual(fill, []);
  assert.deepEqual(confirm, []);
  // Both values are reported, so a form that stays empty is explainable.
  assert.deepEqual(unmatched.map((f) => f.path).sort(), ['identity.email', 'identity.legal_name']);
});

test('one control receives at most one value', () => {
  // "Name" could plausibly attract several values; only the best may land.
  const form = [control('a', { label: 'Name' })];
  const { fill } = matchFields([NAME, EMAIL, PHONE], form);
  assert.equal(fill.length, 1);
  assert.equal(fill[0].ref, 'a');
});

test('the more specific label wins a contested control', () => {
  const employer = packField('employment.current_employer', 'Employer', 'Northwind');
  const form = [
    control('a', { label: 'Company' }),
    control('b', { label: 'Current Employer' }),
  ];
  const { fill } = matchFields([employer], form);
  // "current employer" is the longer, more specific token, so it is preferred
  // over the bare "company" control.
  assert.equal(fill[0].ref, 'b');
});

test('a company name is never mistaken for the applicant name', () => {
  const form = [control('a', { label: 'Company Name' })];
  const { fill, unmatched } = matchFields([NAME], form);
  assert.deepEqual(fill, [], 'the applicant name must not land in a company field');
  assert.equal(unmatched[0].path, 'identity.legal_name');
});

test('a confirm-email field does not receive the address', () => {
  const form = [control('a', { label: 'Confirm Email' })];
  const { fill } = matchFields([EMAIL], form);
  assert.deepEqual(fill, []);
});

test('a reference phone number is not the applicant phone', () => {
  const form = [control('a', { label: "Reference's Phone" })];
  const { fill } = matchFields([PHONE], form);
  assert.deepEqual(fill, []);
});

test('"state" inside "veteran status" is not the applicant state', () => {
  const state = packField('identity.state_region', 'State', 'Texas');
  const form = [control('a', { label: 'Veteran Status' })];
  const { fill } = matchFields([state], form);
  assert.deepEqual(fill, [], '"status" contains "state" and must not attract it');
});

test('a school field is not filled with the employer', () => {
  const employer = packField('employment.current_employer', 'Employer', 'Northwind');
  const form = [control('a', { label: 'School Name' })];
  const { fill } = matchFields([employer], form);
  assert.deepEqual(fill, []);
});

test('address line 2 does not receive the street address', () => {
  const address = packField('identity.address', 'Street address', '1 Main St');
  const form = [control('a', { label: 'Address Line 2' })];
  const { fill } = matchFields([address], form);
  assert.deepEqual(fill, []);
});

test('a value with no rule is reported as unplaceable, not dropped', () => {
  const unknown = packField('something.invented', 'Invented', 'x');
  const { unmatched } = matchFields([unknown], [control('a', { label: 'Anything' })]);
  assert.equal(unmatched.length, 1);
  assert.match(unmatched[0].reason, /does not know how to place/);
});

test('a realistic form fills the obvious fields and withholds the rest', () => {
  const pack = [
    NAME,
    EMAIL,
    PHONE,
    packField('identity.linkedin_url', 'LinkedIn', 'https://linkedin.com/in/ada'),
    packField('eeo.gender_identity', 'Gender identity', 'Woman', true),
  ];
  const form = [
    control('name', { name: 'candidate_name', label: 'Full Name*' }),
    control('email', { autocomplete: 'email', name: 'email' }),
    control('phone', { name: 'phone', label: 'Phone Number', type: 'tel' }),
    control('li', { label: 'LinkedIn Profile' }),
    control('gender', { label: 'Gender' }),
    control('source', { label: 'How did you hear about us?' }),
  ];

  const { fill, confirm, unmatched } = matchFields(pack, form);
  assert.deepEqual(
    fill.map((f) => f.ref).sort(),
    ['email', 'li', 'name', 'phone'],
    'the four unambiguous fields are filled',
  );
  assert.deepEqual(confirm.map((f) => f.ref), ['gender'], 'gender is proposed, not filled');
  assert.deepEqual(unmatched, [], 'everything in the pack found a home');
});
