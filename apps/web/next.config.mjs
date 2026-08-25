// Clerk serves its JS, frontend API, images and bot-protection challenge from
// its own origins. Every one of these must be allowed or authentication does
// not load at all -- the failure is total and silent apart from a console CSP
// violation, so it is worth stating the reason for each entry.
//   *.clerk.accounts.dev  -- development instances (and the FAPI they talk to)
//   *.clerk.com           -- img.clerk.com (avatars) and production FAPI
//   challenges.cloudflare.com -- Clerk's bot protection (Turnstile)
const CLERK_ORIGINS = "https://*.clerk.accounts.dev https://*.clerk.com";
const TURNSTILE = "https://challenges.cloudflare.com";

const securityHeaders = [
  // The session token now lives in Clerk's httpOnly cookie rather than
  // localStorage, so script injection can no longer read it directly. These
  // headers still shrink how an attacker could land a script at all.
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js needs 'unsafe-inline' for its own bootstrap scripts and
      // 'unsafe-eval' in dev (fast refresh); style-src needs 'unsafe-inline'
      // because the app sets inline style={{}} attributes throughout.
      // The Google Programmable Search Engine widget (job search, growth
      // resource search) loads its own script/styles/frames/XHR from
      // Google's domains -- without these the widget silently fails to load.
      // 'unsafe-eval' is also required in production: the CSE widget's own
      // results-rendering code evaluates a string as JavaScript at runtime
      // (confirmed live -- without it, every search throws a visible
      // "EvalError: Evaluating a string as JavaScript violates the CSP"
      // banner instead of rendering results).
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cse.google.com https://www.google.com https://www.gstatic.com ${CLERK_ORIGINS} ${TURNSTILE}`,
      "style-src 'self' 'unsafe-inline' https://www.google.com https://www.gstatic.com",
      `img-src 'self' data: blob: https://*.google.com https://*.gstatic.com https://*.googleusercontent.com ${CLERK_ORIGINS}`,
      "font-src 'self' data:",
      `connect-src 'self' https://cse.google.com https://*.google.com https://www.googleapis.com ${CLERK_ORIGINS}`,
      `frame-src https://cse.google.com https://www.google.com ${CLERK_ORIGINS} ${TURNSTILE}`,
      // Clerk runs part of its handshake in a worker created from a blob URL.
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
