import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import FriendDigestClient from './FriendDigestClient';

/**
 * A shared job digest, as the friend it was made for sees it.
 *
 * Fetched server-side and directly from the API, mirroring
 * apps/web/app/p/[slug]/page.tsx: the /api/kall proxy exists to attach the
 * viewer's Clerk session, and a visitor here may have none. Neither this
 * page nor the friend can apply on anyone's behalf -- every result links
 * only to the real posting.
 */

export type SharedSearchView =
  | { status: 'awaiting_input' }
  | {
      status: 'active' | 'revoked';
      results: Array<{ title: string; company: string; location: string | null; url: string; score: number; strengths: string[] }>;
      last_refreshed_at: string | null;
    };

function apiBaseUrl(): string | null {
  const configured = process.env.KALL_API_URL || process.env.NEXT_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (process.env.NODE_ENV !== 'production') return 'http://localhost:8000';
  return null;
}

async function fetchShare(slug: string): Promise<SharedSearchView | null> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) return null;
  const response = await fetch(`${baseUrl}/api/shared-searches/${encodeURIComponent(slug)}`, {
    // Same reasoning as the career page: a revoked share must read as gone
    // within one request, not up to a cache TTL later.
    cache: 'no-store',
  });
  if (!response.ok) return null;
  return response.json();
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const share = await fetchShare(slug);
  if (!share) return { title: 'Link not found' };
  const title = 'Job matches shared with you';
  const description = 'A batch of job postings matched to a Kall search, refreshed on open.';
  return {
    title: { absolute: title },
    description,
    // Explicit rather than relying on Next's title/description fallback, so
    // a preview card in iMessage/RCS/WhatsApp reads correctly even if that
    // fallback behavior ever changes. Still text-only -- no share image
    // exists for this feature yet, same as the career page precedent this
    // was copied from.
    openGraph: { title, description, type: 'website' },
    robots: { index: false, follow: false },
  };
}

export default async function FriendDigestPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const share = await fetchShare(slug);
  if (!share || share.status === 'revoked') notFound();

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '32px 20px' }}>
      <FriendDigestClient slug={slug} initial={share} />
    </main>
  );
}
