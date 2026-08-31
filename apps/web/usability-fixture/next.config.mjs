// Separate local app: imports production components, never production auth or API routes.
export default { experimental: { externalDir: true }, poweredByHeader: false };
