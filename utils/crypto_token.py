"""Simple Fernet-based token encryption for user FlexQuery tokens."""
import os
import base64
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

_KEY = None


def _get_key() -> bytes:
    global _KEY
    if _KEY is not None:
        return _KEY

    raw = os.environ.get("FLEX_TOKEN_ENCRYPTION_KEY", "")
    if not raw:
        # Dev fallback: deterministic but weak. Production MUST set env var.
        raw = "change_this_in_production_to_a_32byte_random_string!"

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"ib_dashboard_static_salt_2024",
        iterations=100000,
    )
    _KEY = base64.urlsafe_b64encode(kdf.derive(raw.encode()))
    return _KEY


def encrypt_token(token: str) -> str:
    if not token:
        return ""
    return Fernet(_get_key()).encrypt(token.encode()).decode()


def decrypt_token(encrypted: str) -> str:
    if not encrypted:
        return ""
    return Fernet(_get_key()).decrypt(encrypted.encode()).decode()
