from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.config import get_settings
from app.models.user import User
from app.models.user_session import UserSession

REGISTER_URL = "/api/auth/register"
LOGIN_URL = "/api/auth/login"
LOGOUT_URL = "/api/auth/logout"
ME_URL = "/api/auth/me"


def _register(client, email="alice@example.com", password="correct-horse-battery", name="Alice"):
    return client.post(REGISTER_URL, json={"name": name, "email": email, "password": password})


# 1. Successful registration
def test_register_success(client):
    response = _register(client)
    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "alice@example.com"
    assert body["name"] == "Alice"
    assert "id" in body
    assert "password_hash" not in body
    assert response.cookies.get(get_settings().cookie_name) is not None


# 2. Duplicate registration
def test_register_duplicate_email_rejected(client):
    first = _register(client)
    assert first.status_code == 201

    second = _register(client)
    assert second.status_code == 409


# 3. Password is not stored in plaintext
def test_password_not_stored_in_plaintext(client, db_session):
    _register(client, password="my-plaintext-password")

    user = db_session.execute(select(User).where(User.email == "alice@example.com")).scalar_one()
    assert user.password_hash != "my-plaintext-password"
    assert user.password_hash.startswith("$argon2")


# 4. Password hash is not returned
def test_password_hash_never_returned(client):
    response = _register(client)
    assert "password_hash" not in response.text
    assert "password" not in response.json()


# 5. Successful login
def test_login_success(client):
    _register(client)
    response = client.post(LOGIN_URL, json={"email": "alice@example.com", "password": "correct-horse-battery"})
    assert response.status_code == 200
    assert response.json()["email"] == "alice@example.com"
    assert response.cookies.get(get_settings().cookie_name) is not None


# 6. Invalid password
def test_login_invalid_password(client):
    _register(client)
    response = client.post(LOGIN_URL, json={"email": "alice@example.com", "password": "wrong-password"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"


# 7. Invalid credentials (nonexistent email) -- same generic error as #6,
# so the response never reveals whether the email exists.
def test_login_nonexistent_email(client):
    response = client.post(LOGIN_URL, json={"email": "nobody@example.com", "password": "whatever123"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"


# 8. Current user with valid session
def test_me_with_valid_session(client):
    _register(client)
    response = client.get(ME_URL)
    assert response.status_code == 200
    assert response.json()["email"] == "alice@example.com"


# 9. Current user without session
def test_me_without_session(client):
    response = client.get(ME_URL)
    assert response.status_code == 401


# 10. Logout
def test_logout_clears_session(client):
    _register(client)
    assert client.get(ME_URL).status_code == 200

    logout_response = client.post(LOGOUT_URL)
    assert logout_response.status_code == 204

    assert client.get(ME_URL).status_code == 401


# 11. Revoked session cannot authenticate
def test_revoked_session_rejected(client, db_session):
    user_id = _register(client).json()["id"]
    session_row = db_session.execute(
        select(UserSession).where(UserSession.user_id == user_id)
    ).scalar_one()
    session_row.revoked_at = datetime.now(timezone.utc)
    db_session.commit()

    assert client.get(ME_URL).status_code == 401


# 12. Expired session cannot authenticate
def test_expired_session_rejected(client, db_session):
    user_id = _register(client).json()["id"]
    session_row = db_session.execute(
        select(UserSession).where(UserSession.user_id == user_id)
    ).scalar_one()
    session_row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.commit()

    assert client.get(ME_URL).status_code == 401


# 13. Authentication cookie is HTTP-only
def test_cookie_is_httponly(client):
    response = _register(client)
    set_cookie = response.headers.get("set-cookie", "")
    assert "httponly" in set_cookie.lower()


# 14. Cookie security settings reflect configuration
def test_cookie_security_settings(client):
    settings = get_settings()
    response = _register(client)
    set_cookie = response.headers.get("set-cookie", "").lower()

    assert (settings.cookie_samesite.lower() in set_cookie)
    if settings.cookie_secure:
        assert "secure" in set_cookie


# 15. Multiple sessions for the same user
def test_multiple_sessions_for_same_user(client, db_session):
    register_response = _register(client)
    user_id = register_response.json()["id"]

    login_response = client.post(
        LOGIN_URL, json={"email": "alice@example.com", "password": "correct-horse-battery"}
    )
    assert login_response.status_code == 200

    sessions = db_session.execute(
        select(UserSession).where(UserSession.user_id == user_id)
    ).scalars().all()
    assert len(sessions) == 2
    assert sessions[0].token_hash != sessions[1].token_hash


# 16. Session token itself is never stored in plaintext
def test_session_token_not_stored_in_plaintext(client, db_session):
    response = _register(client)
    user_id = response.json()["id"]
    raw_token = response.cookies.get(get_settings().cookie_name)
    assert raw_token is not None

    session_row = db_session.execute(
        select(UserSession).where(UserSession.user_id == user_id)
    ).scalar_one()
    assert session_row.token_hash != raw_token
    assert raw_token not in session_row.token_hash
    assert len(session_row.token_hash) == 64  # sha256 hex digest
