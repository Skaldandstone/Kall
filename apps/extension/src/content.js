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
function applyFills(fills) {
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'collect') {
    sendResponse({ fields: collectFields() });
    return false;
  }
  if (message.type === 'fill') {
    sendResponse(applyFills(message.fills));
    return false;
  }
  if (message.type === 'attachResume') {
    attachResume(message.resume).then(sendResponse);
    return true; // async response
  }
  return false;
});
