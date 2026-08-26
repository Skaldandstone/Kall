/**
 * Drives one fill: pick an application, match its pack against the page, write
 * what is safe, and report everything that was not written and why.
 *
 * The matching happens here rather than in the content script so matcher.js
 * can stay an ES module with unit tests, and so the employer's page never
 * receives Kall data it was not matched to.
 */

import { autofillPack, listApplications, NotSignedInError, resumeDataUrl } from './api.js';
import { matchFields } from './matcher.js';

const applicationSelect = document.querySelector('#application');
const fillButton = document.querySelector('#fill');
const status = document.querySelector('#status');

function render(html) {
  status.innerHTML = html;
}

function list(items) {
  return items.map((item) => `<li>${item}</li>`).join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Inject the content script on demand, so no host permission is needed up front. */
async function send(tabId, message) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content.js'] });
  return chrome.tabs.sendMessage(tabId, message);
}

async function loadApplications() {
  try {
    const applications = await listApplications();
    if (!applications.length) {
      applicationSelect.innerHTML = '<option>No applications yet</option>';
      render('<p class="note">Prepare an application in Kall first, then come back.</p>');
      return;
    }
    applicationSelect.innerHTML = applications
      .map((row) => `<option value="${row.id}">${escapeHtml(row.role)} - ${escapeHtml(row.company)}</option>`)
      .join('');
    fillButton.disabled = false;
  } catch (error) {
    applicationSelect.innerHTML = '<option>Unavailable</option>';
    render(`<p class="problem">${escapeHtml(error.message)}</p>`);
  }
}

async function fill() {
  fillButton.disabled = true;
  render('<p class="note">Reading this form…</p>');

  try {
    const tab = await activeTab();
    const pack = await autofillPack(applicationSelect.value);
    const { fields } = await send(tab.id, { type: 'collect' });

    const { fill: toFill, confirm, unmatched } = matchFields(pack.fields, fields);
    const { applied, failed } = toFill.length
      ? await send(tab.id, { type: 'fill', fills: toFill })
      : { applied: [], failed: [] };

    let resumeNote = '';
    if (pack.resume) {
      try {
        const { dataUrl, type } = await resumeDataUrl(pack.resume.download_url);
        const result = await send(tab.id, {
          type: 'attachResume',
          resume: { dataUrl, filename: pack.resume.filename, type },
        });
        resumeNote = result.attached
          ? `<p>Attached <strong>${escapeHtml(result.filename)}</strong>.</p>`
          : `<p class="withheld">Resume not attached: ${escapeHtml(result.reason)}</p>`;
      } catch (error) {
        resumeNote = `<p class="problem">Resume not attached: ${escapeHtml(error.message)}</p>`;
      }
    }

    // Everything Kall did not fill is named, with a reason. A form that comes
    // out half-empty should never be a mystery.
    const withheld = [
      ...confirm.map((f) => `${escapeHtml(f.label)} - needs your answer, Kall will not answer this for you`),
      ...unmatched.map((f) => `${escapeHtml(f.label)} - ${escapeHtml(f.reason)}`),
      ...(pack.omitted || []).map((f) => `${escapeHtml(f.label)} - ${escapeHtml(f.reason)}`),
      ...failed.map((f) => `${escapeHtml(f.label)} - ${escapeHtml(f.reason)}`),
    ];

    render(`
      <section>
        <h2>Filled ${applied.length}</h2>
        ${applied.length ? `<ul>${list(applied.map((f) => escapeHtml(f.label)))}</ul>` : '<p class="note">Nothing matched on this page.</p>'}
        ${resumeNote}
      </section>
      ${withheld.length ? `<section><h2>Left for you</h2><ul class="withheld">${list(withheld)}</ul></section>` : ''}
      <section><p class="note">Check every field, then submit the form yourself.</p></section>
    `);
  } catch (error) {
    render(
      error instanceof NotSignedInError
        ? `<p class="problem">${escapeHtml(error.message)}</p>`
        : `<p class="problem">${escapeHtml(error.message)}</p>`,
    );
  } finally {
    fillButton.disabled = false;
  }
}

fillButton.addEventListener('click', fill);
void loadApplications();
