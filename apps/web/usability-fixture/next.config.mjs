// Separate local app: imports production components, never production auth or API routes.
export default {
  experimental: { externalDir: true },
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; form-action 'self'; base-uri 'self'" }] }];
  },
};
