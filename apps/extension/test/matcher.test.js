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

/**
 * Captured from a live Greenhouse application form, verbatim, by running
 * content.js's own collectFields() against it. Greenhouse is the most common
 * ATS in this market, and this shape is what actually broke the matcher: the
 * name is split in two and there is no full-name control anywhere.
 *
 * The trailing entries with no signals at all are real -- they are the hidden
 * text inputs behind Greenhouse's custom comboboxes. They must attract
 * nothing.
 */
const GREENHOUSE_FORM = [
  control('f0', { id: 'first_name', autocomplete: 'given-name', label: 'First Name*' }),
  control('f1', { id: 'last_name', autocomplete: 'family-name', label: 'Last Name*' }),
  control('f2', { id: 'email', autocomplete: 'email', label: 'Email*' }),
  control('f3', { id: 'country', autocomplete: 'off', label: 'Country' }),
  control('f4', { id: 'phone', autocomplete: 'off', type: 'tel', label: 'Phone' }),
  control('f5', { id: 'question_14364081008', autocomplete: 'off', label: 'Please note that you will not be considered unless you complete the Co' }),
  control('f6', {}),
  control('f7', { id: 'question_18371453008', autocomplete: 'off', label: 'Please read the arbitration agreement below*' }),
  control('f8', {}),
  control('f9', { id: 'question_18374455008', autocomplete: 'off', label: 'Agreement to Arbitrate*' }),
  control('f10', {}),
];

test('a real Greenhouse form gets the split name, and custom questions are left alone', () => {
  const pack = [
    NAME,
    EMAIL,
    PHONE,
    packField('identity.country', 'Country', 'United States'),
  ];
  const { fill, unmatched } = matchFields(pack, GREENHOUSE_FORM);
  const byRef = Object.fromEntries(fill.map((f) => [f.ref, f.value]));

  assert.equal(byRef.f0, 'Ada', 'first name');
  assert.equal(byRef.f1, 'Lovelace', 'last name');
  assert.equal(byRef.f2, 'ada@example.com');
  assert.equal(byRef.f4, '+1 512 555 0100');
  assert.equal(byRef.f3, 'United States');

  // Arbitration agreements and screening questions are the applicant's to
  // answer. Kall must not put anything in them.
  for (const ref of ['f5', 'f6', 'f7', 'f8', 'f9', 'f10']) {
    assert.equal(byRef[ref], undefined, `${ref} must be left alone`);
  }
  assert.deepEqual(unmatched, [], 'the whole pack found a home');
});

test('the split name is not reported as missing when the form takes it whole', () => {
  const form = [control('a', { label: 'Full Name' })];
  const { fill, unmatched } = matchFields([NAME], form);
  assert.equal(fill.length, 1);
  assert.equal(fill[0].path, 'identity.legal_name');
  // "First name has nowhere to go" is not something a user can act on.
  assert.deepEqual(unmatched, []);
});

test('a single-token name is not split into a blank surname', () => {
  const mononym = packField('identity.legal_name', 'Full name', 'Prince');
  const form = [control('a', { autocomplete: 'given-name' }), control('b', { autocomplete: 'family-name' })];
  const { fill } = matchFields([mononym], form);
  assert.deepEqual(fill, [], 'better to leave both empty than invent a surname');
});
