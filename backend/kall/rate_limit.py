from slowapi import Limiter
from slowapi.util import get_remote_address

from kall.config import get_settings

# Applied to unauthenticated, abuse-prone endpoints (registration, login,
# password reset, email verification). The existing per-account lockout in
# login() stops credential stuffing against one account but does nothing for
# registration spam, password-reset email bombing, or distributed username
# enumeration across many accounts -- this closes that gap.
#
# Disabled under APP_ENV=test: pytest resets this process-wide singleton
# between tests (see tests/conftest.py), but the Playwright e2e suite runs
# against one long-lived backend process for the whole run, so every spec's
# registrations/logins share one bucket keyed by 127.0.0.1 -- a handful of
# e2e tests each registering an account is enough to trip "5/hour" for real
# and fail later, unrelated tests.
limiter = Limiter(key_func=get_remote_address, enabled=get_settings().app_env != "test")
