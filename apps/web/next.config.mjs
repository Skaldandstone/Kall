// Clerk serves its JS, frontend API, images and bot-protection challenge from
// its own origins. Every one of these must be allowed or authentication does
// not load at all -- the failure is total and silent apart from a console CSP
// violation, so it is worth stating the reason for each entry.
//   *.clerk.accounts.dev  -- development instances (and the FAPI they talk to)
//   *.clerk.com           -- img.clerk.com (avatars) and production FAPI
//   clerk.kall.skaldandstone.com -- Kall production's Clerk custom domain
//   challenges.cloudflare.com -- Clerk's bot protection (Turnstile)
const CLERK_ORIGINS = "https://*.clerk.accounts.dev https://*.clerk.com https://clerk.kall.skaldandstone.com";
const TURNSTILE = "https://challenges.cloudflare.com";

// Work-sample embed providers, allowed ONLY on the public career page.
// Must stay in step with EMBED_FRAME_ORIGINS in backend/kall/services/embeds.py
// -- a provider missing here renders as an empty box with nothing but a
// console warning to explain it. There is a backend test asserting the two
// lists agree.
const EMBED_FRAMES = [
  "https://www.youtube-nocookie.com",
  "https://player.vimeo.com",
  "https://www.loom.com",
  "https://codepen.io",
  "https://www.figma.com",
].join(" ");
// Providers serve poster images and thumbnails from their own CDNs.
const EMBED_IMAGES = "https://i.ytimg.com https://i.vimeocdn.com https://cdn.loom.com https://s3-alpha.figma.com";

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
  // Kall serves trusted public icons directly and uses no next/image or static
  // image imports. Close the unused optimizer and automatic import loader.
  // This reduces exposure; it does not repair Next's vendored image-size parser.
  // File-based metadata images use a separate loader: review before adding any.
  // Evidence and re-enablement gates: docs/continuation/next-image-parser-security.md.
  images: {
    unoptimized: true,
    disableStaticImages: true,
  },
  async headers() {
    // Two policies. The public career page is the only route that frames
    // third-party content, so it gets the embed origins and the rest of the
    // application does not -- an XSS anywhere else still cannot open a frame.
    const careerPageHeaders = securityHeaders.map((header) =>
      header.key === "Content-Security-Policy"
        ? {
            key: header.key,
            value: header.value
              .replace("frame-src ", `frame-src ${EMBED_FRAMES} `)
              .replace("img-src ", `img-src ${EMBED_IMAGES} `),
          }
        : header,
    );
    return [
      // Negative lookahead so the two rules never both match: a route matched
      // by both would receive two CSP headers, and browsers intersect them,
      // which would block the embeds this exists to allow.
      { source: "/((?!p/).*)", headers: securityHeaders },
      { source: "/p/:path*", headers: careerPageHeaders },
    ];
  },
};

export default nextConfig;
