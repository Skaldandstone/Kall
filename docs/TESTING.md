# Testing

CI runs backend linting, Python compilation, pytest coverage, Alembic migration execution, and a Next.js production build. Run the same checks locally before merging.

## Machine-readable test artifacts

The `backend` and `e2e` CI jobs upload machine-readable results on every run (not just on failure):

- `backend-test-results` — `coverage.json` (`pytest --cov-report=json`) and `junit.xml` (`pytest --junitxml`) from the backend job.
- `e2e-junit` — `junit.xml` from the Playwright run (`apps/web/playwright.config.ts`'s `junit` reporter).

These exist so external tooling (e.g. a coverage-based risk dashboard) can read real per-file coverage and per-test pass/fail history via the GitHub Actions API instead of guessing from console output. Download them locally the same way CI does:

```bash
pytest --cov=kall --cov-report=json:coverage.json --junitxml=junit.xml
```

Both files are gitignored — they're CI/local run output, not checked-in artifacts.
