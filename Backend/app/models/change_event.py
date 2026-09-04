import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.enums import ChangeEventSeverity, ChangeEventType


class ChangeEvent(Base):
    __tablename__ = "change_events"
    __table_args__ = (
        Index("ix_change_events_user_id_detected_at", "user_id", "detected_at"),
        Index(
            "ix_change_events_unacknowledged",
            "user_id",
            "acknowledged_at",
            postgresql_where=text("acknowledged_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    stock_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("stocks.id", ondelete="CASCADE"), nullable=False
    )
    # Nullable + SET NULL: a watchlist can be deleted by its owner without
    # destroying the historical record of change events that referenced it.
    watchlist_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("watchlists.id", ondelete="SET NULL"), nullable=True
    )
    type: Mapped[ChangeEventType] = mapped_column(
        SAEnum(ChangeEventType, name="change_event_type"), nullable=False
    )
    severity: Mapped[ChangeEventSeverity] = mapped_column(
        SAEnum(ChangeEventSeverity, name="change_event_severity"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship()
    stock: Mapped["Stock"] = relationship()
    watchlist: Mapped["Watchlist"] = relationship()
