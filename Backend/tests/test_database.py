from sqlalchemy import text

from app.database import SessionLocal, engine


def test_engine_configured():
    assert engine is not None
    assert str(engine.url).startswith("postgresql+psycopg://")


def test_database_connection_can_be_tested():
    with SessionLocal() as session:
        result = session.execute(text("SELECT 1"))
        assert result.scalar() == 1
