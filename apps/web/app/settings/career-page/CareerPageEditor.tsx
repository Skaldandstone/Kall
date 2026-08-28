'use client';

import { useCallback, useEffect, useState } from 'react';
import { showToast } from '../../components/ToastHost';
import styles from './editor.module.css';

const API = '/api/kall';

type Section = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  position: number;
  visible: boolean;
  source: string | null;
  item_ids: number[];
  layout: string;
  options: { samples?: Sample[] } | null;
};

/**
 * A work sample. The user pastes a link; the server decides whether it is a
 * provider it can embed and reduces it to an id. `provider` comes back as
 * "link" for anything unrecognised, which the public page renders as a link
 * rather than guessing at an iframe.
 */
type Sample = {
  title: string;
  caption: string;
  provider: string;
  url: string;
};

type Page = {
  slug: string;
  published: boolean;
  display_name: string | null;
  headline: string | null;
  summary: string | null;
  location: string | null;
  theme: string;
  links: { label: string; url: string }[];
  view_count: number;
};

type Kind = { kind: string; source: string | null };
type Record_ = { id: number; [key: string]: unknown };

/** A short human label for a profile record, whatever kind it is. */
function describe(row: Record_): string {
  const parts = [
    row.job_title ?? row.role ?? row.name ?? row.title ?? row.institution ?? row.author_name ?? row.organization,
    row.employer ?? row.issuing_organization ?? row.organization_or_venue ?? row.event ?? row.degree
      ?? row.membership_type ?? (row.role ? row.organization : null),
  ].filter(Boolean);
  return parts.length ? parts.join(' - ') : `Record ${row.id}`;
}

export default function CareerPageEditor() {
  const [page, setPage] = useState<Page | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [records, setRecords] = useState<Record<string, Record_[]>>({});
  const [slugDraft, setSlugDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const response = await fetch(`${API}/me/career-page`);
    if (response.status === 401) { window.location.replace('/sign-in'); return; }
    if (!response.ok) { setError('Could not load your career page.'); return; }
    const data = await response.json();
    setPage(data.page);
    setSections(data.sections);
    setKinds(data.available_kinds);
    setSlugDraft(data.page.slug);
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** Records for a sourced section, fetched once and reused. */
  const loadRecords = useCallback(async (source: string) => {
    if (records[source]) return;
    const path = source === 'testimonials' ? '/testimonials' : `/profile/resources/${source}`;
    const response = await fetch(API + path);
    if (!response.ok) return;
    // Await outside the updater: the setState callback is synchronous.
    const rows = await response.json();
    setRecords((current) => ({ ...current, [source]: rows }));
  }, [records]);

  useEffect(() => {
    for (const section of sections) {
      if (section.source) void loadRecords(section.source);
    }
  }, [sections, loadRecords]);

  async function patchPage(data: Partial<Page>) {
    setBusy(true);
    setError('');
    const response = await fetch(`${API}/me/career-page`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    setBusy(false);
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      setError(typeof detail?.detail === 'string' ? detail.detail : 'That change could not be saved.');
      return false;
    }
    setPage(await response.json());
    return true;
  }

  async function patchSection(id: number, data: Partial<Section>) {
    // Update locally first so typing and toggling stay responsive; the row is
    // small and the request is the source of truth on reload.
    setSections((current) => current.map((s) => (s.id === id ? { ...s, ...data } : s)));
    const response = await fetch(`${API}/me/career-page/sections/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    // Options are the one field the server rewrites rather than stores as
    // sent: a work sample's URL comes back reduced to a provider. Without
    // taking that back, someone pasting a link gets no answer to the only
    // question they have -- will this actually play on my page? Only options
    // is re-synced, so a slow response cannot clobber what they are typing.
    if (response.ok && data.options) {
      const saved: Section = await response.json();
      setSections((current) =>
        current.map((s) => (s.id === id ? { ...s, options: saved.options } : s)),
      );
    }
  }

  async function move(id: number, direction: -1 | 1) {
    const index = sections.findIndex((s) => s.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[index], next[target]] = [next[target], next[index]];
    setSections(next);
    await fetch(`${API}/me/career-page/sections/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section_ids: next.map((s) => s.id) }),
    });
  }

  async function addSection(kind: string) {
    const response = await fetch(`${API}/me/career-page/sections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, title: kind.charAt(0).toUpperCase() + kind.slice(1) }),
    });
    if (response.ok) void load();
  }

  async function removeSection(id: number) {
    await fetch(`${API}/me/career-page/sections/${id}`, { method: 'DELETE' });
    setSections((current) => current.filter((s) => s.id !== id));
  }

  /** Toggle one record in or out of a sourced section, preserving order. */
  function toggleItem(section: Section, recordId: number) {
    const all = (records[section.source ?? ''] ?? []).map((row) => row.id);
    // An empty list means "all of them", so the first removal has to become an
    // explicit list of everything else -- otherwise unticking one would read
    // as unticking nothing.
    const current = section.item_ids.length ? section.item_ids : all;
    const next = current.includes(recordId)
      ? current.filter((id) => id !== recordId)
      : [...current, recordId];
    void patchSection(section.id, { item_ids: next });
  }

  async function copyLink() {
    if (!page) return;
    const url = `${window.location.origin}/p/${page.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied.', 'success');
    } catch {
      showToast(url, 'info');
    }
  }

  if (!page) {
    return <p className="muted">{error || 'Loading your career page…'}</p>;
  }

  const used = new Set(sections.map((s) => s.kind));

  return (
    <div className={styles.editor}>
      <section className="card">
        <div className={styles.publishRow}>
          <div>
            <h2>{page.published ? 'Published' : 'Not published'}</h2>
            <p className="muted">
              {page.published
                ? 'Anyone with the link can read this page.'
                : 'Only you can see this. Nothing is public until you publish.'}
            </p>
          </div>
          <div className={styles.publishActions}>
            {page.published && (
              <>
                <a className="button secondary" href={`/p/${page.slug}`} target="_blank" rel="noreferrer">
                  View
                </a>
                <button className="button secondary" type="button" onClick={copyLink}>
                  Copy link
                </button>
              </>
            )}
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => patchPage({ published: !page.published })}
            >
              {page.published ? 'Unpublish' : 'Publish'}
            </button>
          </div>
        </div>
        {page.published && page.view_count > 0 && (
          <p className="muted">{page.view_count} view{page.view_count === 1 ? '' : 's'}.</p>
        )}
      </section>

      <section className="card">
        <h2>Address and heading</h2>
        <div className="form">
          <label>
            <span className="muted">Public address</span>
            <div className={styles.slugRow}>
              <span className={styles.slugPrefix}>/p/</span>
              <input
                className="input"
                name="slug"
                value={slugDraft}
                onChange={(event) => setSlugDraft(event.target.value)}
                onBlur={() => slugDraft !== page.slug && patchPage({ slug: slugDraft })}
              />
            </div>
          </label>
          <label>
            <span className="muted">Name</span>
            <input
              className="input"
              name="display_name"
              defaultValue={page.display_name ?? ''}
              onBlur={(event) => patchPage({ display_name: event.target.value })}
            />
          </label>
          <label>
            <span className="muted">Headline</span>
            <input
              className="input"
              name="headline"
              placeholder="Head of Technology"
              defaultValue={page.headline ?? ''}
              onBlur={(event) => patchPage({ headline: event.target.value })}
            />
          </label>
          <label>
            <span className="muted">Summary</span>
            <textarea
              className="input"
              name="summary"
              rows={3}
              defaultValue={page.summary ?? ''}
              onBlur={(event) => patchPage({ summary: event.target.value })}
            />
          </label>
          <label>
            <span className="muted">Location</span>
            <input
              className="input"
              name="location"
              defaultValue={page.location ?? ''}
              onBlur={(event) => patchPage({ location: event.target.value })}
            />
          </label>
          <label>
            <span className="muted">Theme</span>
            <select
              className="input"
              name="theme"
              value={page.theme}
              onChange={(event) => patchPage({ theme: event.target.value })}
            >
              <option value="parchment">Parchment</option>
              <option value="meridian">Meridian</option>
            </select>
          </label>
        </div>
        {error && <p className="notice" role="alert">{error}</p>}
      </section>

      <section className="card">
        <h2>Sections</h2>
        <p className="muted">
          Order them however the argument reads best. Hidden sections keep their content.
        </p>

        <ol className={styles.sectionList}>
          {sections.map((section, index) => (
            <li key={section.id} className={`${styles.section} ${section.visible ? '' : styles.hidden}`}>
              <div className={styles.sectionHead}>
                <div className={styles.reorder}>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Move ${section.title} up`}
                    disabled={index === 0}
                    onClick={() => move(section.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Move ${section.title} down`}
                    disabled={index === sections.length - 1}
                    onClick={() => move(section.id, 1)}
                  >
                    ↓
                  </button>
                </div>
                <input
                  className={styles.titleInput}
                  aria-label={`${section.kind} title`}
                  defaultValue={section.title}
                  onBlur={(event) => patchSection(section.id, { title: event.target.value })}
                />
                <label className={styles.toggle}>
                  <input
                    type="checkbox"
                    checked={section.visible}
                    onChange={(event) => patchSection(section.id, { visible: event.target.checked })}
                  />
                  <span>Show</span>
                </label>
                <button
                  type="button"
                  className="button ghost"
                  onClick={() => removeSection(section.id)}
                >
                  Remove
                </button>
              </div>

              <textarea
                className="input"
                aria-label={`${section.kind} text`}
                rows={3}
                placeholder={section.source ? 'Optional introduction above the records' : 'Write this section'}
                defaultValue={section.body ?? ''}
                onBlur={(event) => patchSection(section.id, { body: event.target.value })}
              />

              {section.kind === 'samples' && (
                <SampleEditor
                  samples={section.options?.samples ?? []}
                  onChange={(samples) => patchSection(section.id, { options: { ...(section.options ?? {}), samples } })}
                />
              )}

              {section.source && (
                <details className={styles.picker}>
                  <summary>
                    Choose entries
                    <span className="muted">
                      {section.item_ids.length
                        ? ` ${section.item_ids.length} selected`
                        : ' all of them'}
                    </span>
                  </summary>
                  <ul>
                    {(records[section.source] ?? []).map((row) => {
                      const chosen = section.item_ids.length === 0 || section.item_ids.includes(row.id);
                      return (
                        <li key={row.id}>
                          <label>
                            <input
                              type="checkbox"
                              checked={chosen}
                              onChange={() => toggleItem(section, row.id)}
                            />
                            <span>{describe(row)}</span>
                          </label>
                        </li>
                      );
                    })}
                    {(records[section.source] ?? []).length === 0 && (
                      <li className="muted">Nothing saved in your profile for this yet.</li>
                    )}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ol>

        <div className={styles.addRow}>
          <span className="muted">Add a section</span>
          <div className={styles.addButtons}>
            {kinds
              .filter((kind) => kind.kind === 'custom' || !used.has(kind.kind))
              .map((kind) => (
                <button
                  key={kind.kind}
                  type="button"
                  className="button secondary"
                  onClick={() => addSection(kind.kind)}
                >
                  {kind.kind}
                </button>
              ))}
          </div>
        </div>
      </section>
    </div>
  );
}


/** Add, describe and remove the work samples on a `samples` section. */
function SampleEditor({
  samples,
  onChange,
}: {
  samples: Sample[];
  onChange: (samples: Sample[]) => void;
}) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');

  function add() {
    const trimmed = url.trim();
    if (!trimmed) return;
    // provider is filled in by the server; it is not guessed here.
    onChange([...samples, { url: trimmed, title: title.trim(), caption: '', provider: '' }]);
    setUrl('');
    setTitle('');
  }

  return (
    <div className={styles.samples}>
      <p className="muted">
        Paste a link to work you have already published. YouTube, Vimeo, Loom,
        CodePen and Figma play on the page; anything else appears as a link.
      </p>

      <ul className={styles.sampleList}>
        {samples.map((sample, index) => (
          <li key={`${sample.url}-${index}`}>
            <span className={styles.sampleTitle}>{sample.title || sample.url}</span>
            {sample.provider && sample.provider !== 'link' && (
              <span className="muted"> · {sample.provider}</span>
            )}
            {sample.provider === 'link' && <span className="muted"> · link only</span>}
            <button
              type="button"
              className="button ghost"
              aria-label={`Remove ${sample.title || sample.url}`}
              onClick={() => onChange(samples.filter((_, position) => position !== index))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <div className={styles.sampleAdd}>
        <input
          className="input"
          aria-label="Work sample title"
          placeholder="Title (optional)"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <input
          className="input"
          aria-label="Work sample link"
          placeholder="https://"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="button secondary" onClick={add}>
          Add sample
        </button>
      </div>
    </div>
  );
}
