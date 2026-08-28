/**
 * Drives one fill: pick an application, match its pack against the page, write
 * what is safe, and report everything that was not written and why.
 *
 * The matching happens here rather than in the content script so matcher.js
 * can stay an ES module with unit tests, and so the employer's page never
 * receives Kall data it was not matched to.
 */

import { autofillPack, captureJob, deps, listApplications, listProfessionalProfiles, NotSignedInError, resumeDataUrl } from './api.js';
import { getClerk, getSessionToken, onAuthChange, openSignIn } from './auth.js';
import { matchFields } from './matcher.js';

// api.js does not import auth.js itself (see api.js's own comment on `deps`)
// so this is the one place that connects them.
deps.getSessionToken = getSessionToken;

const applicationSelect = document.querySelector('#application');
const fillButton = document.querySelector('#fill');
const status = document.querySelector('#status');
const profileSelect = document.querySelector('#capture-profile');
const captureButton = document.querySelector('#capture');
const captureStatus = document.querySelector('#capture-status');

function render(html) {
  status.innerHTML = html;
}

function renderCapture(html) {
  captureStatus.innerHTML = html;
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

/**
 * The one thing a signed-out popup can offer: a button that opens the real
 * sign-in page. Previously this state just said "sign in to Kall in your
 * browser, then try again" and left it there, passively, even when someone
 * genuinely was signed in on the web app -- the extension had no way to see
 * that, since it relied on a cookie that a cross-origin fetch cannot carry.
 * See auth.js and api.js for the actual fix; this button is a courtesy
 * on top of it, not the fix itself.
 */
function renderSignedOut() {
  applicationSelect.innerHTML = '<option>Sign in required</option>';
  fillButton.disabled = true;
  profileSelect.innerHTML = '<option>Sign in required</option>';
  captureButton.disabled = true;
  render('<button id="sign-in" class="link-button">Sign in to Kall</button>');
  document.querySelector('#sign-in')?.addEventListener('click', () => void openSignIn());
}

async function loadApplications() {
  let clerk;
  try {
    clerk = await getClerk();
  } catch (error) {
    // Clerk itself failed to initialize -- most likely this extension's
    // origin has not been added to the web app's Clerk instance yet (see
    // docs/EXTENSION_CLERK_SETUP.md), which is a setup problem, not a
    // signed-out one. Left uncaught, this would leave the popup stuck on
    // its initial "Loading..." forever with nothing but a console error to
    // explain why.
    applicationSelect.innerHTML = '<option>Unavailable</option>';
    render(`<p class="problem">Could not connect to Kall's sign-in: ${escapeHtml(error.message)}</p>`);
    return;
  }
  if (!clerk.session) {
    renderSignedOut();
    return;
  }

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
    if (error instanceof NotSignedInError) {
      renderSignedOut();
      return;
    }
    applicationSelect.innerHTML = '<option>Unavailable</option>';
    render(`<p class="problem">${escapeHtml(error.message)}</p>`);
  }
}

/** Independent of loadApplications: a signed-in account with zero prepared
 * applications should still be able to save a job for later. */
async function loadProfiles() {
  try {
    const profiles = await listProfessionalProfiles();
    if (!profiles.length) {
      profileSelect.innerHTML = '<option>No career profiles yet</option>';
      renderCapture('<p class="note">Create a professional profile in Kall first.</p>');
      return;
    }
    profileSelect.innerHTML = profiles.map((row) => `<option value="${row.id}">${escapeHtml(row.name)}</option>`).join('');
    captureButton.disabled = false;
  } catch (error) {
    if (error instanceof NotSignedInError) return; // renderSignedOut already covers this
    profileSelect.innerHTML = '<option>Unavailable</option>';
    renderCapture(`<p class="problem">${escapeHtml(error.message)}</p>`);
  }
}

async function capture() {
  captureButton.disabled = true;
  renderCapture('<p class="note">Reading this page…</p>');

  try {
    const tab = await activeTab();
    const scraped = await send(tab.id, { type: 'scrapeJob' });
    if (!scraped.title) {
      renderCapture('<p class="problem">Could not find a job on this page.</p>');
      return;
    }
    const saved = await captureJob({
      url: tab.url,
      title: scraped.title,
      company: scraped.company || undefined,
      location: scraped.location || undefined,
      description: scraped.description || undefined,
      professional_profile_id: Number(profileSelect.value),
    });
    renderCapture(`<p>Saved -- ${saved.match_score}% match. Find it in your opportunity inbox.</p>`);
  } catch (error) {
    renderCapture(
      error instanceof NotSignedInError
        ? `<p class="problem">${escapeHtml(error.message)}</p>`
        : `<p class="problem">${escapeHtml(error.message)}</p>`,
    );
  } finally {
    captureButton.disabled = false;
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
captureButton.addEventListener('click', capture);
void loadApplications();
void loadProfiles();
// Catches the moment a sync completes -- someone who clicked "Sign in to
// Kall", finished it in the new tab, and comes back to this popup without
// needing to close and reopen it. If Clerk itself is not reachable this
// never attaches, which only costs the auto-refresh convenience --
// loadApplications() above already showed the real reason, and reopening
// the popup tries again.
onAuthChange(() => { void loadApplications(); void loadProfiles(); }).catch(() => {});
