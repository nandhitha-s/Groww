import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Stock(Base):
    __tablename__ = "stocks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    symbol: Mapped[str] = mapped_column(String(20), nullable=False, unique=True, index=True)
    # Nullable: a stock may first be created as a placeholder (symbol only)
    # when a user adds it to a watchlist, before the market-data phase
    # enriches it with real metadata.
    company_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    exchange: Mapped[str | None] = mapped_column(String(50), nullable=True)
    sector: Mapped[str | None] = mapped_column(String(100), nullable=True)
    industry: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    watchlist_items: Mapped[list["WatchlistItem"]] = relationship(
        back_populates="stock", cascade="all, delete-orphan", passive_deletes=True
    )
    snapshots: Mapped[list["MarketSnapshot"]] = relationship(
        back_populates="stock", cascade="all, delete-orphan", passive_deletes=True
    )
    user_states: Mapped[list["UserStockState"]] = relationship(
        back_populates="stock", cascade="all, delete-orphan", passive_deletes=True
    )
    news_events: Mapped[list["NewsEvent"]] = relationship(
        back_populates="stock", cascade="all, delete-orphan", passive_deletes=True
    )
    market_events: Mapped[list["MarketEvent"]] = relationship(
        back_populates="stock", cascade="all, delete-orphan", passive_deletes=True
    )

    @staticmethod
    def normalize_symbol(symbol: str) -> str:
        return symbol.strip().upper()
