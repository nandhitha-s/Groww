from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration loaded from environment variables / .env."""

    database_url: str

    # Authentication session / cookie configuration.
    session_expire_minutes: int = 60 * 24 * 7  # 7 days
    cookie_name: str = "session_token"
    cookie_secure: bool = True
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"

    # FYERS API v3 -- an optional, non-default market-data provider kept
    # for future use (requires a broker account + daily manual login, so
    # it is not the active provider; see app/providers/fyers.py). All
    # optional: the rest of the app must keep working without them.
    fyers_app_id: str | None = None
    fyers_access_token: str | None = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
