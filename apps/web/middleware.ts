import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Everything that must stay reachable signed-out: the marketing site and its
// demos, the legal pages, the auth screens themselves, and
// /testimonial-submit -- that one is opened by a former colleague from an
// emailed invitation link, so it is deliberately unauthenticated.
const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/demo(.*)',
  '/privacy-policy',
  '/testimonial-submit(.*)',
  // A published career page is meant to be opened by someone with no Kall
  // account -- a recruiter, a hiring manager. That is the entire feature.
  '/p/(.*)',
  // The API calls that page makes must be public too, or the recipient can
  // open the form and never be able to submit it. Both endpoints authenticate
  // on the single-use invitation token itself (api_testimonials.py), not on a
  // Kall session -- the person answering has no account by definition.
  '/api/kall/testimonials/submit',
  '/api/kall/testimonials/withdraw',
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next internals and static files, but always run on API routes --
    // the /api/kall proxy mints the backend token from the session, so it
    // needs the Clerk context.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
