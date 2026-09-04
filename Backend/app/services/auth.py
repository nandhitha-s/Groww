from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.core.security import generate_session_token, hash_password, hash_session_token, verify_password
from app.models.user import User
from app.models.user_session import UserSession


class EmailAlreadyRegisteredError(Exception):
    """Raised when registering with an email that already has an account."""


class InvalidCredentialsError(Exception):
    """Raised for any login failure. Deliberately does not distinguish
    between "no such user" and "wrong password" so callers cannot leak
    which case occurred."""


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _create_session(db: Session, user: User, settings: Settings) -> str:
    raw_token = generate_session_token()
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_session_token(raw_token),
            expires_at=_utcnow() + timedelta(minutes=settings.session_expire_minutes),
        )
    )
    db.flush()
    return raw_token


def register_user(db: Session, *, name: str, email: str, password: str) -> tuple[User, str]:
    """Create a user and an initial session in one transaction.

    Raises EmailAlreadyRegisteredError (and rolls back) if the email is
    already taken, including under a concurrent-registration race.
    """
    settings = get_settings()

    existing = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if existing is not None:
        raise EmailAlreadyRegisteredError()

    user = User(name=name, email=email, password_hash=hash_password(password))
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise EmailAlreadyRegisteredError() from exc

    raw_token = _create_session(db, user, settings)

    db.commit()
    db.refresh(user)
    return user, raw_token


def authenticate_user(db: Session, *, email: str, password: str) -> tuple[User, str]:
    """Verify credentials and create a new session.

    Raises InvalidCredentialsError for both a nonexistent email and a wrong
    password, with no observable difference between the two.
    """
    settings = get_settings()

    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None or not verify_password(password, user.password_hash):
        raise InvalidCredentialsError()

    raw_token = _create_session(db, user, settings)

    db.commit()
    db.refresh(user)
    return user, raw_token


def get_user_by_session_token(db: Session, raw_token: str) -> User | None:
    """Resolve a raw session token to its user, or None if the session is
    missing, revoked, or expired."""
    token_hash = hash_session_token(raw_token)
    session = db.execute(
        select(UserSession).where(UserSession.token_hash == token_hash)
    ).scalar_one_or_none()

    if session is None or session.revoked_at is not None or session.expires_at <= _utcnow():
        return None

    return db.get(User, session.user_id)


def revoke_session(db: Session, raw_token: str) -> None:
    """Revoke the session for a raw token. No-ops if it doesn't exist or is
    already revoked -- logout must never fail on an invalid session."""
    token_hash = hash_session_token(raw_token)
    session = db.execute(
        select(UserSession).where(UserSession.token_hash == token_hash)
    ).scalar_one_or_none()

    if session is not None and session.revoked_at is None:
        session.revoked_at = _utcnow()
        db.commit()
