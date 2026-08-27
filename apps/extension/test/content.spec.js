import { test, expect } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { matchFields } from '../src/matcher.js';

/**
 * Exercises the real content script against a real DOM.
 *
 * The matcher has unit tests, but the half that reads controls out of a page
 * and writes values back had none -- and that half is where the browser-shaped
 * mistakes live: labels bound four different ways, React ignoring a direct
 * `.value` assignment, `input.files` being read-only, and a <select> whose
 * options never match the stored wording verbatim.
 *
 * src/content.js is loaded as-is rather than refactored for testability, so
 * what runs here is what ships. It expects a `chrome.runtime.onMessage` to
 * register against; the stub below captures that listener so the test can
 * drive it exactly as the popup would.
 */

const FIXTURE = pathToFileURL(
  path.join(import.meta.dirname, 'fixtures', 'application-form.html'),
).href;
const CONTENT_SCRIPT = path.join(import.meta.dirname, '..', 'src', 'content.js');

/** The values Kall would supply for this application. */
const PACK_FIELDS = [
  { path: 'identity.legal_name', label: 'Full name', value: 'Ada Lovelace' },
  { path: 'identity.email', label: 'Email', value: 'ada@example.com' },
  { path: 'identity.phone', label: 'Phone', value: '+1 512 555 0100' },
  { path: 'identity.linkedin_url', label: 'LinkedIn', value: 'https://linkedin.com/in/ada' },
  { path: 'identity.state_region', label: 'State / region', value: 'Texas' },
  { path: 'employment.current_employer', label: 'Current employer', value: 'Northwind Systems' },
  {
    path: 'eeo.veteran_status',
    label: 'Veteran status',
    value: 'I am not a protected veteran',
    requires_confirmation: true,
  },
];

async function loadPage(page) {
  await page.goto(FIXTURE);
  // Stand in for the extension runtime and capture the message handler.
  await page.evaluate(() => {
    window.__handler = null;
    window.chrome = { runtime: { onMessage: { addListener: (fn) => { window.__handler = fn; } } } };
  });
  await page.addScriptTag({ path: CONTENT_SCRIPT });
  await expect.poll(() => page.evaluate(() => Boolean(window.__handler))).toBe(true);
}

/** Call the content script the way the popup does. */
function send(page, message) {
  return page.evaluate(
    (msg) =>
      new Promise((resolve) => {
        const async = window.__handler(msg, {}, resolve);
        if (!async) return; // sendResponse was already called synchronously
      }),
    message,
  );
}

test('reads every fillable control, and ignores the ones it must not touch', async ({ page }) => {
  await loadPage(page);
  const { fields } = await send(page, { type: 'collect' });
  const names = fields.map((f) => f.name);

  expect(names).toContain('name');
  expect(names).toContain('email');
  expect(names).toContain('veteran');
  // The file input is handled separately, and the submit button is not a field.
  expect(names).not.toContain('resume');
  expect(fields.some((f) => f.type === 'submit')).toBe(false);
});

test('finds labels however the form happens to bind them', async ({ page }) => {
  await loadPage(page);
  const { fields } = await send(page, { type: 'collect' });
  const labelOf = (name) => fields.find((f) => f.name === name)?.label;

  expect(labelOf('name')).toContain('Full Name'); // label[for]
  expect(labelOf('phone')).toContain('Phone Number'); // wrapping label
  expect(labelOf('state')).toContain('State'); // <legend> only
});

test('fills the right controls and leaves the traps empty', async ({ page }) => {
  await loadPage(page);
  const { fields } = await send(page, { type: 'collect' });
  const { fill, confirm } = matchFields(PACK_FIELDS, fields);
  await send(page, { type: 'fill', fills: fill });

  const value = (selector) => page.locator(selector).inputValue();

  expect(await value('#applicant_name')).toBe('Ada Lovelace');
  expect(await value('#email')).toBe('ada@example.com');
  expect(await value('[name="phone"]')).toBe('+1 512 555 0100');
  expect(await value('#linkedin')).toBe('https://linkedin.com/in/ada');
  expect(await value('#employer')).toBe('Northwind Systems');
  expect(await value('[name="state"]')).toBe('Texas');

  // The traps. Getting any of these wrong puts someone's details in the wrong
  // place on a form they are about to send to an employer.
  expect(await value('#email_confirm')).toBe('');
  expect(await value('#company_name')).toBe('');
  expect(await value('#ref_phone')).toBe('');
  expect(await value('#source')).toBe('');

  // EEO is matched but must be left for the person to answer.
  expect(confirm.map((f) => f.path)).toEqual(['eeo.veteran_status']);
  expect(await value('#veteran')).toBe('');
});

test('dispatches input and change so a React form notices', async ({ page }) => {
  await loadPage(page);
  const { fields } = await send(page, { type: 'collect' });
  const { fill } = matchFields(PACK_FIELDS, fields);
  await send(page, { type: 'fill', fills: fill });

  const events = await page.evaluate(() => window.__events);
  // Assigning .value directly fires neither; a React-controlled input would
  // revert the value on its next render.
  expect(events).toContain('name:input');
  expect(events).toContain('name:change');
});

test('a dropdown with no matching option is reported, not forced', async ({ page }) => {
  await loadPage(page);
  const { fields } = await send(page, { type: 'collect' });
  const veteran = fields.find((f) => f.name === 'veteran');

  const { applied, failed } = await send(page, {
    type: 'fill',
    fills: [{
      path: 'eeo.veteran_status',
      label: 'Veteran status',
      value: 'Nothing like any option',
      ref: veteran.ref,
    }],
  });

  expect(applied).toEqual([]);
  expect(failed).toHaveLength(1);
  expect(failed[0].reason).toMatch(/No matching option/);
  // Choosing an arbitrary option would turn an empty answer into a wrong one.
  expect(await page.locator('#veteran').inputValue()).toBe('');
});

test('a dropdown is set when an option genuinely matches', async ({ page }) => {
  await loadPage(page);
  const { fields } = await send(page, { type: 'collect' });
  const veteran = fields.find((f) => f.name === 'veteran');

  const { applied } = await send(page, {
    type: 'fill',
    fills: [{
      path: 'eeo.veteran_status',
      label: 'Veteran status',
      // Matched on the option's visible text, not its value attribute.
      value: 'I am not a protected veteran',
      ref: veteran.ref,
    }],
  });

  expect(applied).toHaveLength(1);
  expect(await page.locator('#veteran').inputValue()).toBe('not_protected');
});

test('attaches the resume to the file input', async ({ page }) => {
  await loadPage(page);
  const result = await send(page, {
    type: 'attachResume',
    resume: {
      // input.files is read-only, so this goes through a DataTransfer list.
      dataUrl: 'data:text/plain;base64,QWRhIExvdmVsYWNlIC0gcmVzdW1l',
      filename: 'ada-lovelace.txt',
      type: 'text/plain',
    },
  });

  expect(result.attached).toBe(true);
  const attached = await page.evaluate(() => {
    const input = document.querySelector('#resume');
    return { count: input.files.length, name: input.files[0]?.name };
  });
  expect(attached).toEqual({ count: 1, name: 'ada-lovelace.txt' });
});

test('never submits the form', async ({ page }) => {
  await loadPage(page);
  const { fields } = await send(page, { type: 'collect' });
  const { fill } = matchFields(PACK_FIELDS, fields);
  await send(page, { type: 'fill', fills: fill });
  await send(page, {
    type: 'attachResume',
    resume: { dataUrl: 'data:text/plain;base64,eA==', filename: 'r.txt', type: 'text/plain' },
  });

  // The whole design rests on this: the person applying reads the form and
  // sends it themselves.
  expect(await page.evaluate(() => window.__submitted)).toBe(false);
});

test('an ARIA combobox is filled by clicking its own listbox option', async ({ page }) => {
  // A true <select> is matched by option -- see the two tests above. An ARIA
  // combobox (Workday, Greenhouse's newer forms, Lever all use this pattern
  // for country) is a plain <input> as far as SELECTOR is concerned, so
  // writing text into it is not enough: the widget only treats a value as
  // chosen when its own handler sees a click on a listbox option. The
  // assertion on __countryCommitted() is the one that matters -- it is the
  // fixture's stand-in for "the framework's own state actually changed",
  // which inputValue() alone cannot tell you.
  await loadPage(page);
  const { fields } = await send(page, { type: 'collect' });
  const country = fields.find((f) => f.id === 'country-input');
  expect(country, 'the combobox input should still be collected as a field').toBeTruthy();

  const { applied } = await send(page, {
    type: 'fill',
    fills: [{ path: 'identity.country', label: 'Country', value: 'United States', ref: country.ref }],
  });

  expect(applied).toHaveLength(1);
  expect(await page.locator('#country-input').inputValue()).toBe('United States');
  expect(await page.evaluate(() => window.__countryCommitted())).toBe('United States');
});

test('an ARIA combobox with no matching option is reported, not left looking filled', async ({ page }) => {
  // Same rule as a <select> with no matching option: text sitting in the box
  // while the widget never registered a choice is worse than an empty field,
  // because it reads as filled in on review.
  await loadPage(page);
  const { fields } = await send(page, { type: 'collect' });
  const country = fields.find((f) => f.id === 'country-input');

  const { applied, failed } = await send(page, {
    type: 'fill',
    fills: [{ path: 'identity.country', label: 'Country', value: 'Wakanda', ref: country.ref }],
  });

  expect(applied).toEqual([]);
  expect(failed).toHaveLength(1);
  expect(failed[0].reason).toMatch(/Could not confirm/);
  expect(await page.evaluate(() => window.__countryCommitted())).toBe('');
});
