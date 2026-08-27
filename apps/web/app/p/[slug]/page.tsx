import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import styles from './page.module.css';

/**
 * A published career page, as a stranger sees it.
 *
 * Fetched server-side and directly from the API rather than through
 * /api/kall -- that proxy exists to attach the viewer's Clerk session, and a
 * visitor here has none. Going direct keeps the page genuinely public and
 * renders it on the server, which is what makes it shareable: a link that
 * previews properly and reads without JavaScript.
 */

type Item = Record<string, string | number | boolean | string[] | null>;

/**
 * A work sample. `frame_url` is built on the server from a provider allowlist
 * and is null for anything unrecognised, which renders as a link instead --
 * this component never constructs an embed URL from user input.
 */
type Sample = {
  title: string;
  caption: string;
  provider: string;
  url: string;
  frame_url: string | null;
  aspect_ratio: number | null;
};

type Section = {
  kind: string;
  title: string;
  body: string | null;
  layout: 'list' | 'grid' | 'timeline';
  items: Item[];
  samples?: Sample[];
};

function SampleBlock({ sample }: { sample: Sample }) {
  if (!sample.frame_url) {
    // Not a provider we embed. A link is the honest fallback; guessing an
    // iframe for an arbitrary URL is how a public page becomes a liability.
    // Beside two rich embeds, a bare line of text reads as something that
    // failed to load. Give it a card of its own so it looks like a deliberate
    // link rather than a broken video.
    let host = '';
    try {
      host = new URL(sample.url).hostname.replace(/^www\./, '');
    } catch {
      host = '';
    }
    return (
      <article className={styles.sample}>
        <a
          className={styles.sampleLink}
          href={sample.url}
          rel="noopener noreferrer nofollow"
          target="_blank"
        >
          <span className={styles.sampleLinkTitle}>{sample.title || sample.url}</span>
          {host ? <span className={styles.sampleLinkHost}>{host} ↗</span> : null}
        </a>
        {sample.caption ? <p>{sample.caption}</p> : null}
      </article>
    );
  }
  return (
    <article className={styles.sample}>
      {sample.title ? <h3>{sample.title}</h3> : null}
      <div
        className={styles.frame}
        style={{ paddingBottom: `${sample.aspect_ratio ?? 56.25}%` }}
      >
        <iframe
          src={sample.frame_url}
          title={sample.title || `${sample.provider} work sample`}
          loading="lazy"
          allowFullScreen
          // Least privilege: enough for a video or prototype to run, nothing
          // that would let the frame reach back into the page.
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      {sample.caption ? <p>{sample.caption}</p> : null}
    </article>
  );
}

type PublicPage = {
  slug: string;
  display_name: string | null;
  headline: string | null;
  summary: string | null;
  location: string | null;
  theme: string;
  links: { label: string; url: string }[];
  professional_summary: string | null;
  sections: Section[];
};

function apiBaseUrl(): string | null {
  const configured = process.env.KALL_API_URL || process.env.NEXT_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (process.env.NODE_ENV !== 'production') return 'http://localhost:8000';
  return null;
}

async function fetchPage(slug: string): Promise<PublicPage | null> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) return null;
  const response = await fetch(`${baseUrl}/api/career-pages/${encodeURIComponent(slug)}`, {
    // Deliberately uncached. An earlier version revalidated every 60s, which
    // meant unpublishing left the page readable to anyone holding the link for
    // up to a minute -- caught when a test hit a stale copy from a previous
    // run, because Next's cache lives on disk and outlives the server.
    //
    // This is someone's control over their own visibility. "Take it down"
    // has to mean down, and one API call per view is a fair price for that.
    cache: 'no-store',
  });
  if (!response.ok) return null;
  return response.json();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await fetchPage(slug);
  if (!page) return { title: 'Page not found' };

  const name = page.display_name ?? 'Career page';
  const description = page.summary ?? page.headline ?? page.professional_summary ?? undefined;
  return {
    // `absolute` bypasses the root layout's "%s — Kall" template: a page
    // someone shares as their own should not be branded as a Kall screen.
    title: { absolute: page.headline ? `${name} - ${page.headline}` : name },
    description,
    openGraph: { title: name, description, type: 'profile' },
    // This is the whole point of the page, so let it be found.
    robots: { index: true, follow: true },
  };
}

/** Dates arrive as ISO strings; only the year and month are worth showing. */
function period(start: unknown, end: unknown, current: unknown): string {
  const year = (value: unknown) => (typeof value === 'string' ? value.slice(0, 4) : null);
  const from = year(start);
  const to = current === true ? 'Present' : year(end);
  if (from && to) return `${from} - ${to}`;
  return from ?? to ?? '';
}

function ItemBlock({ kind, item }: { kind: string; item: Item }) {
  if (kind === 'history') {
    return (
      <article className={styles.entry}>
        <div className={styles.entryHead}>
          <h3>{String(item.job_title ?? '')}</h3>
          <span className={styles.period}>
            {period(item.start_date, item.end_date, item.is_current)}
          </span>
        </div>
        <p className={styles.org}>
          {String(item.employer ?? '')}
          {item.location ? ` - ${item.location}` : ''}
        </p>
        {item.description ? <p>{String(item.description)}</p> : null}
      </article>
    );
  }

  if (kind === 'skills') {
    return <span className={styles.tag}>{String(item.name ?? '')}</span>;
  }

  if (kind === 'testimonials') {
    return (
      <figure className={styles.quote}>
        <blockquote>{String(item.body ?? '')}</blockquote>
        <figcaption>
          {String(item.author_name ?? '')}
          {item.author_title ? `, ${item.author_title}` : ''}
          {item.author_company ? `, ${item.author_company}` : ''}
        </figcaption>
      </figure>
    );
  }

  if (kind === 'education') {
    return (
      <article className={styles.entry}>
        <div className={styles.entryHead}>
          <h3>{String(item.institution ?? '')}</h3>
          <span className={styles.period}>{period(item.graduation_date, null, false)}</span>
        </div>
        <p className={styles.org}>
          {[item.degree, item.major].filter(Boolean).join(', ')}
        </p>
      </article>
    );
  }

  // Certifications, awards, publications and speaking all read as
  // title + issuer + date, so one shape covers them.
  const title = item.name ?? item.title ?? '';
  const issuer = item.issuing_organization ?? item.organization_or_venue ?? item.event ?? '';
  const when = item.obtained_on ?? item.received_on ?? item.published_on ?? item.occurred_on;
  const href = item.url ?? item.verification_url ?? item.evidence_url;

  return (
    <article className={styles.entry}>
      <div className={styles.entryHead}>
        <h3>
          {href ? (
            <a href={String(href)} rel="noopener noreferrer nofollow" target="_blank">
              {String(title)}
            </a>
          ) : (
            String(title)
          )}
        </h3>
        {when ? <span className={styles.period}>{period(when, null, false)}</span> : null}
      </div>
      {issuer ? <p className={styles.org}>{String(issuer)}</p> : null}
      {item.description ? <p>{String(item.description)}</p> : null}
    </article>
  );
}

export default async function CareerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await fetchPage(slug);
  if (!page) notFound();

  // Named themes only -- the value comes from the database, so it must never
  // be interpolated into a style. An unknown name falls back rather than
  // rendering unthemed.
  const themeName = page.theme === 'meridian' ? 'meridian' : 'parchment';
  const theme = themeName === 'meridian' ? styles.meridian : styles.parchment;
  const visible = page.sections.filter(
    (section) =>
      section.body ||
      section.items.length > 0 ||
      (section.samples?.length ?? 0) > 0 ||
      section.kind === 'intro',
  );

  return (
    <main className={`${styles.page} ${theme}`} data-cp-theme={themeName}>
      <nav className={styles.nav} aria-label="Sections">
        <span className={styles.navName}>{page.display_name}</span>
        <ul>
          {visible
            .filter((section) => section.kind !== 'intro')
            .map((section) => (
              <li key={section.kind + section.title}>
                <a href={`#${section.kind}`}>{section.title}</a>
              </li>
            ))}
        </ul>
      </nav>

      <header className={styles.hero}>
        <h1>{page.display_name}</h1>
        {page.headline ? <p className={styles.headline}>{page.headline}</p> : null}
        {page.summary ? <p className={styles.summary}>{page.summary}</p> : null}
        {page.location ? <p className={styles.meta}>{page.location}</p> : null}
        {page.links.length > 0 ? (
          <ul className={styles.links}>
            {page.links.map((link) => (
              <li key={link.url}>
                <a href={link.url} rel="noopener noreferrer nofollow" target="_blank">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      {visible.map((section) => {
        if (section.kind === 'intro') {
          return section.body ? (
            <section key="intro" id="intro" className={styles.section}>
              <p className={styles.lede}>{section.body}</p>
            </section>
          ) : null;
        }
        return (
          <section key={section.kind + section.title} id={section.kind} className={styles.section}>
            <h2>{section.title}</h2>
            {section.body ? <p className={styles.lede}>{section.body}</p> : null}
            {section.samples && section.samples.length > 0 ? (
              <div className={styles.samples}>
                {section.samples.map((sample, index) => (
                  <SampleBlock key={`${section.kind}-sample-${index}`} sample={sample} />
                ))}
              </div>
            ) : null}
            {section.items.length > 0 ? (
              <div className={section.layout === 'grid' ? styles.grid : styles.stack}>
                {section.items.map((item, index) => (
                  <ItemBlock key={`${section.kind}-${item.id ?? index}`} kind={section.kind} item={item} />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </main>
  );
}
