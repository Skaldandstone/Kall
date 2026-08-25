// app.json stays the source of truth for everything except the API base
// URL, which needs to be overridable for e2e/local testing against a
// non-production backend without hand-editing app.json each time (the
// previous approach, error-prone and easy to accidentally commit).
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    apiBaseUrl: process.env.API_BASE_URL || config.extra.apiBaseUrl,
  },
});
