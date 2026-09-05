from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.user import User
from app.services import auth as auth_service


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    """Reusable auth dependency for protected routes.

    Reads the HttpOnly session cookie, validates it against the DB, and
    returns the corresponding User.  Raises 401 if the cookie is missing,
    the session is expired, or the session has been revoked.

    Usage: current_user: User = Depends(get_current_user)
    """
    settings = get_settings()
    raw_token = request.cookies.get(settings.cookie_name)

    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    user = auth_service.get_user_by_session_token(db, raw_token)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired or invalid",
        )

    return user

