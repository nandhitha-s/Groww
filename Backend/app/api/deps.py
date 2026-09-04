from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.user import User
from app.services import auth as auth_service

_cookie_name = get_settings().cookie_name


def get_current_user(
    session_token: str | None = Cookie(default=None, alias=_cookie_name),
    db: Session = Depends(get_db),
) -> User:
    """Reusable auth dependency for protected routes.

    Usage: current_user: User = Depends(get_current_user)
    """
    if session_token is not None:
        user = auth_service.get_user_by_session_token(db, session_token)
        if user is not None:
            return user

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
