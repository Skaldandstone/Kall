from slowapi import Limiter
from slowapi.util import get_remote_address

# Applied to unauthenticated, abuse-prone endpoints (registration, login,
# password reset, email verification). The existing per-account lockout in
# login() stops credential stuffing against one account but does nothing for
# registration spam, password-reset email bombing, or distributed username
# enumeration across many accounts -- this closes that gap.
limiter = Limiter(key_func=get_remote_address)
