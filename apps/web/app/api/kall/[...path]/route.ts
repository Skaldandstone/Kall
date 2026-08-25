import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

function apiBaseUrl(): string | null {
  const configured = process.env.KALL_API_URL || process.env.NEXT_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (process.env.NODE_ENV !== 'production') return 'http://localhost:8000';
  return null;
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) {
    return NextResponse.json(
      { detail: 'Kall API URL is not configured on the web service.' },
      { status: 503 },
    );
  }

  const { path } = await context.params;
  const target = new URL(`${baseUrl}/api/${path.join('/')}`);
  target.search = request.nextUrl.search;

  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);

  // The token is minted here, server-side, from whatever session Clerk
  // resolves -- normally the httpOnly cookie, so the browser never holds a
  // token of its own.
  //
  // Note what this does and does not do. The incoming `authorization` header
  // is never copied through: a garbage one is discarded rather than forwarded
  // to the API (verified -- it 404s at the middleware exactly like no header
  // at all). But Clerk's own auth() does accept a *valid* Clerk token
  // presented that way as a real session, which is deliberate: the mobile app
  // calls the API with a bearer token and no cookie. So this is not a
  // header-rejecting proxy; it is a proxy that re-derives the token from the
  // session rather than trusting the caller's copy of it.
  const { getToken } = await auth();
  const token = await getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);

  const response = await fetch(target, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
    cache: 'no-store',
    // OAuth start and callback endpoints intentionally return redirects. Those
    // redirects must reach the browser rather than being followed by the
    // Next.js server under the Kall origin.
    redirect: 'manual',
  });

  const responseHeaders = new Headers();
  const responseContentType = response.headers.get('content-type');
  const location = response.headers.get('location');
  if (responseContentType) responseHeaders.set('content-type', responseContentType);
  if (location) responseHeaders.set('location', location);

  return new NextResponse(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

export const dynamic = 'force-dynamic';

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
