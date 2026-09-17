import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from kall.config import get_settings


def _fernet() -> Fernet:
    settings = get_settings()
    raw = settings.sensitive_data_encryption_key or settings.app_secret_key
    digest = hashlib.sha256(raw.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_sensitive(value: str | None) -> str | None:
    if value is None:
        return None
    return _fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_sensitive(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        return _fernet().decrypt(value.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return None


def unsubscribe_token(user_id: int) -> str:
    """An opaque, unforgeable token identifying a user for the one-click
    List-Unsubscribe endpoint -- no session, no login, so a mail client can
    POST it with no user interaction (RFC 8058)."""
    return encrypt_sensitive(str(user_id)) or ""


def user_id_from_unsubscribe_token(token: str) -> int | None:
    decrypted = decrypt_sensitive(token)
    if decrypted is None or not decrypted.isdigit():
        return None
    return int(decrypted)
