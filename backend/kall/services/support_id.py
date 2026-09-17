"""Generates the random 8-digit code a user can quote to support instead of
their email address (see `User.support_id`). Same retry-until-unique shape
as `shared_search.generate_slug`, swapped to a fixed-width numeric alphabet
since this one is meant to be read aloud and typed, not pasted."""

import secrets

from kall.models.core import User
from sqlmodel import Session, select


def generate_support_id(session: Session) -> str:
    while True:
        candidate = f"{secrets.randbelow(10**8):08d}"
        if not session.exec(select(User).where(User.support_id == candidate)).first():
            return candidate
