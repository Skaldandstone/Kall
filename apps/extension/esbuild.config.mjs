// Bundles popup.js into popup.bundle.js.
//
// Everything else in this extension ships unbundled, on purpose: content.js
// is injected via chrome.scripting.executeScript({ files: [...] }), which
// only runs classic scripts, not ES modules, so it cannot import anything and
// never needed a bundler. matcher.js is a plain ES module popup.js already
// imported directly, and stays that way for its unit tests
// (test/matcher.test.js imports it with no build step).
//
// popup.js is different only because it now imports @clerk/chrome-extension,
// a real npm package with its own dependency graph -- something a browser
// cannot load from a bare specifier without a bundler. This is the smallest
// change that makes that import work: one entry point, one output file,
// nothing else in the extension restructured.
import { build } from "esbuild";

await build({
  entryPoints: ["src/popup.js"],
  bundle: true,
  format: "esm",
  target: "chrome110",
  outfile: "src/popup.bundle.js",
  sourcemap: true,
  logLevel: "info",
  // Sentry's DSN is compiled in rather than read at runtime: the popup has
  // no server to ask and a DSN is public by design (it can only send
  // events to one project). Unset -> an empty string -> src/sentry.js never
  // initializes the SDK, so local builds and CI stay inert. (The SDK's code
  // is still bundled: esbuild inlines the dynamic import() behind the DSN
  // check; only its initializer is skipped.) See .env.example.
  define: {
    __SENTRY_DSN__: JSON.stringify(process.env.SENTRY_DSN ?? ""),
    __SENTRY_ENVIRONMENT__: JSON.stringify(process.env.SENTRY_ENVIRONMENT ?? ""),
  },
});
