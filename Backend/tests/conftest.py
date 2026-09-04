import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.database import engine, get_db
from app.main import app


@pytest.fixture()
def db_session():
    """A Session bound to a single connection, wrapped in an outer
    transaction + SAVEPOINT that is always rolled back at teardown.

    This lets tests run against the real (already-migrated) Supabase
    database without ever persisting rows: any commit() issued by service
    code only releases the SAVEPOINT, a new one is opened immediately, and
    the outer transaction rollback at the end discards everything.
    """
    connection = engine.connect()
    outer_transaction = connection.begin()
    session = Session(bind=connection, expire_on_commit=False)

    nested = connection.begin_nested()

    @event.listens_for(session, "after_transaction_end")
    def _restart_savepoint(sess, trans):
        nonlocal nested
        if not nested.is_active:
            nested = connection.begin_nested()

    try:
        yield session
    finally:
        session.close()
        outer_transaction.rollback()
        connection.close()


@pytest.fixture()
def client(db_session: Session):
    """A TestClient whose get_db dependency is overridden to use the
    rollback-only db_session fixture, so requests made through it never
    leave permanent rows in the shared Supabase database."""

    def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    try:
        # base_url is https so that Secure-flagged auth cookies (the
        # production default) are actually stored and resent by the
        # client's cookie jar, matching real browser behavior over HTTPS.
        with TestClient(app, base_url="https://testserver") as test_client:
            yield test_client
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture()
def client2(db_session: Session):
    """A second TestClient sharing the same rollback-only db_session as
    `client` (same test transaction/data), but with its own cookie jar --
    for tests needing two independently authenticated users at once."""

    def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    try:
        with TestClient(app, base_url="https://testserver") as test_client:
            yield test_client
    finally:
        app.dependency_overrides.pop(get_db, None)
