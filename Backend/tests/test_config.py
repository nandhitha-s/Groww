from app.config import get_settings


def test_settings_load_database_url():
    settings = get_settings()
    assert settings.database_url
    assert settings.database_url.startswith("postgresql+psycopg://")
