import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import Argon2Error

_password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    """Hash a plaintext password with Argon2. Never store the raw password."""
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Verify a plaintext password against an Argon2 hash.

    Returns False for any verification failure (wrong password, corrupt or
    foreign hash format) rather than raising, so callers always get a plain
    boolean instead of having to know argon2's exception hierarchy.
    """
    try:
        return _password_hasher.verify(password_hash, password)
    except Argon2Error:
        return False


def generate_session_token() -> str:
    """Generate a cryptographically secure, high-entropy session token.

    Uses `secrets` (CSPRNG), never UUIDs, timestamps, or `random`.
    """
    return secrets.token_urlsafe(32)


def hash_session_token(token: str) -> str:
    """Hash a raw session token for storage.

    The raw token already has 256 bits of entropy, so a plain SHA-256 digest
    (no salt/pepper) is sufficient here -- unlike passwords, this is not a
    low-entropy secret that needs a slow KDF.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
