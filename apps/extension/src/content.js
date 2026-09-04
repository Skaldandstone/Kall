/**
 * The only code that touches the employer's page.
 *
 * Kept deliberately dumb: it reads form controls into plain descriptors and
 * writes back values it is told to write. It makes no decisions about what
 * belongs where -- that is matcher.js, which runs in the popup where it can be
 * an ES module and can be tested without a browser.
 *
 * It never submits. There is no code path here that clicks a submit button or
 * calls form.submit(), and that is the point of the whole design: the person
 * applying reads the form and sends it themselves.
 */

/** Controls we can meaningfully fill. */
const SELECTOR = 'input, select, textarea';
const SKIPPED_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'password']);

const elements = new Map();

/** Visible text of the <label> bound to a control, if any. */
function labelFor(element) {
  if (element.id) {
    const bound = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    if (bound?.textContent?.trim()) return bound.textContent.trim();
  }
  const wrapping = element.closest('label');
  if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();

  // Many application forms label a group with a heading rather than a <label>
  // (Workday and Greenhouse both do). Fall back to the nearest preceding text
  // inside the control's own container.
  const container = element.closest('div, fieldset, section');
  const heading = container?.querySelector('legend, label, h1, h2, h3, h4, span');
  return heading?.textContent?.trim() || '';
}

function isFillable(element) {
  if (element.disabled || element.readOnly) return false;
  if (element.tagName === 'INPUT' && SKIPPED_TYPES.has(element.type)) return false;
  // offsetParent is null for display:none; a zero-size box catches the rest.
  const box = element.getBoundingClientRect();
  return Boolean(element.offsetParent) && box.width > 0 && box.height > 0;
}

/** Describe every fillable control, and remember which element each refers to. */
function collectFields() {
  elements.clear();
  const descriptors = [];
  let index = 0;

  for (const element of document.querySelectorAll(SELECTOR)) {
    if (element.type === 'file') continue;
    if (!isFillable(element)) continue;
    const ref = `f${index++}`;
    elements.set(ref, element);
    descriptors.push({
      ref,
      tag: element.tagName.toLowerCase(),
      type: element.type || '',
      name: element.name || '',
      id: element.id || '',
      autocomplete: element.getAttribute('autocomplete') || '',
      placeholder: element.getAttribute('placeholder') || '',
      ariaLabel: element.getAttribute('aria-label') || '',
      label: labelFor(element),
      // Lets the popup show a <select>'s real options rather than guessing.
      options: element.tagName === 'SELECT'
        ? [...element.options].map((option) => ({ value: option.value, text: option.text.trim() }))
        : undefined,
    });
  }
  return descriptors;
}

/**
 * Set a value the way a person would, so the page notices.
 *
 * Assigning `.value` directly is invisible to React, which tracks its own
 * copy of the value on the DOM node and skips the change as a no-op. Going
 * through the native prototype setter and then dispatching input/change is
 * what makes React-based forms -- which is most modern ATS software -- accept
 * the value instead of reverting it on the next render.
 */
function setValue(element, value) {
  const prototype = element.tagName === 'SELECT'
    ? window.HTMLSelectElement.prototype
    : element.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) setter.call(element, value);
  else element.value = value;

  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * An ARIA combobox: a text input plus a popup listbox, not a native <select>.
 * This is how Workday, Greenhouse's newer forms, and Lever render pickers
 * like country -- SELECTOR only sees the <input>, and typing into it alone
 * does not "select" anything. The widget's own state (and the hidden field a
 * form actually submits) only updates when its own handler sees a click or a
 * keypress on one of its listbox options.
 *
 * This rests on the ARIA authoring contract (role="combobox",
 * aria-controls/aria-owns pointing at role="listbox" options) rather than any
 * one vendor's internals, which is the only part of a JS-driven widget that
 * is safe to assume across sites. A widget that skips ARIA roles entirely --
 * unfortunately not rare -- is not something this can detect, and this never
 * pretends to have confirmed a selection it did not actually see accepted.
 */
function comboboxListbox(element) {
  const id = element.getAttribute('aria-controls') || element.getAttribute('aria-owns');
  return id ? document.getElementById(id) : null;
}

function findComboboxOption(listbox, value) {
  const wanted = String(value).trim().toLowerCase();
  return [...listbox.querySelectorAll('[role="option"]')].find(
    (option) => option.textContent.trim().toLowerCase() === wanted,
  ) || null;
}

/**
 * Click an option the way a person would. Some widgets commit on mousedown
 * (so a later blur cannot close the popup before the choice registers),
 * others wait for click -- firing the whole sequence covers both without
 * needing to know which.
 */
function clickOption(option) {
  for (const type of ['mousedown', 'mouseup', 'click']) {
    option.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Try to fill an ARIA combobox. Returns true only if an option was actually
 * clicked -- never for "we typed something and hoped". Some widgets fetch or
 * filter their option list asynchronously after the input event, so this
 * waits briefly and checks once more before giving up.
 */
async function fillCombobox(element, value) {
  setValue(element, value);
  for (const delay of [0, 150]) {
    if (delay) await wait(delay);
    const listbox = comboboxListbox(element);
    const option = listbox && findComboboxOption(listbox, value);
    if (option) {
      clickOption(option);
      return true;
    }
  }
  return false;
}

/** For a <select>, find the option that actually corresponds to `value`. */
function selectOption(element, value) {
  const wanted = String(value).trim().toLowerCase();
  const match = [...element.options].find(
    (option) =>
      option.value.trim().toLowerCase() === wanted ||
      option.text.trim().toLowerCase() === wanted,
  );
  if (!match) return false;
  setValue(element, match.value);
  return true;
}

/** Write the values the popup decided on. Returns what actually landed. */
async function applyFills(fills) {
  const applied = [];
  const failed = [];

  for (const fill of fills) {
    const element = elements.get(fill.ref);
    if (!element) {
      failed.push({ ...fill, reason: 'That field is no longer on the page.' });
      continue;
    }
    const value = Array.isArray(fill.value) ? fill.value.join(', ') : String(fill.value ?? '');
    if (element.tagName === 'SELECT') {
      if (!selectOption(element, value)) {
        // Never force an arbitrary option: picking the wrong one on a
        // dropdown is a wrong answer, not an empty one.
        failed.push({ ...fill, reason: 'No matching option in that dropdown.' });
        continue;
      }
    } else if (element.getAttribute('role') === 'combobox') {
      if (!(await fillCombobox(element, value))) {
        // Same rule as a <select>: text sitting in the box while the widget
        // never registered a choice is a worse outcome than an empty field,
        // because it looks filled in on review.
        failed.push({ ...fill, reason: 'Could not confirm a selection in that dropdown.' });
        continue;
      }
    } else {
      setValue(element, value);
    }
    element.style.outline = '2px solid #c9a86a';
    element.style.outlineOffset = '1px';
    applied.push({ path: fill.path, label: fill.label, ref: fill.ref });
  }
  return { applied, failed };
}

/** Put the stored resume into the form's file input. */
async function attachResume({ dataUrl, filename, type }) {
  const input = [...document.querySelectorAll('input[type="file"]')].find(
    (element) => !element.disabled && element.offsetParent !== null,
  );
  if (!input) return { attached: false, reason: 'No file upload field found on this page.' };

  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], filename, { type: type || blob.type });
  // input.files is read-only; a DataTransfer list is the supported way to
  // populate it programmatically.
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { attached: true, filename };
}

/**
 * Every <script type="application/ld+json"> block on the page describing a
 * schema.org JobPosting. LinkedIn, Indeed, Greenhouse, Lever, and most ATS
 * platforms emit this for SEO -- it is the one job-listing shape that is
 * common across sites, so reading it beats hand-maintaining CSS selectors
 * per site (which break the moment any of them redesigns their page).
 */
function jobPostingLinkedData() {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    let parsed;
    try {
      parsed = JSON.parse(script.textContent || '');
    } catch {
      continue;
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed, ...(parsed?.['@graph'] || [])];
    const posting = candidates.find((entry) => entry && entry['@type'] === 'JobPosting');
    if (posting) return posting;
  }
  return null;
}

function textOf(value) {
  if (typeof value !== 'string') return '';
  // JobPosting descriptions are usually raw HTML and come straight from
  // whatever page we're scraping, so treat them as untrusted: parse with
  // DOMParser (which never executes scripts, even if a node is later
  // attached) rather than assigning to innerHTML.
  const doc = new DOMParser().parseFromString(value, 'text/html');
  return (doc.body.textContent || '').trim();
}

function locationOf(posting) {
  const place = posting.jobLocation?.address || posting.jobLocation?.[0]?.address;
  if (!place) return posting.applicantLocationRequirements?.name || '';
  return [place.addressLocality, place.addressRegion, place.addressCountry].filter(Boolean).join(', ');
}

/**
 * Best-effort job details from whatever is on the current page. Never
 * throws: a page with none of this is a page with nothing to scrape, not an
 * error, so the popup can show a plain "couldn't find a job on this page"
 * rather than an exception.
 */
function scrapeJob() {
  const posting = jobPostingLinkedData();
  if (posting) {
    return {
      title: textOf(posting.title) || document.title,
      company: textOf(posting.hiringOrganization?.name),
      location: locationOf(posting),
      description: textOf(posting.description),
    };
  }
  // No structured data on this page (some LinkedIn page states omit it) --
  // fall back to what every page has: the tab title and an OpenGraph/meta
  // description, which is still enough for a person to recognize the saved
  // job later even without a clean company/location split.
  const meta = (name) => document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.content || '';
  return {
    title: document.title,
    company: '',
    location: '',
    description: meta('og:description') || meta('description'),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'collect') {
    sendResponse({ fields: collectFields() });
    return false;
  }
  if (message.type === 'fill') {
    applyFills(message.fills).then(sendResponse);
    return true; // async response: a combobox fill waits briefly on the page
  }
  if (message.type === 'attachResume') {
    attachResume(message.resume).then(sendResponse);
    return true; // async response
  }
  if (message.type === 'scrapeJob') {
    sendResponse(scrapeJob());
    return false;
  }
  return false;
});
