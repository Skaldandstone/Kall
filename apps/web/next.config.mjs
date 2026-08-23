const securityHeaders = [
  // Bearer tokens live in localStorage, so an XSS bug is the realistic path
  // to account takeover here. These headers don't fix that at the source,
  // but they shrink how an attacker could actually land a script in the
  // first place, and limit the blast radius if one gets in.
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
      "script-src 'self' 'unsafe-inline' https://cse.google.com https://www.google.com https://www.gstatic.com" + (process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : ""),
      "style-src 'self' 'unsafe-inline' https://www.google.com https://www.gstatic.com",
      "img-src 'self' data: blob: https://*.google.com https://*.gstatic.com https://*.googleusercontent.com",
      "font-src 'self' data:",
      "connect-src 'self' https://cse.google.com https://*.google.com https://www.googleapis.com",
      "frame-src https://cse.google.com https://www.google.com",
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
