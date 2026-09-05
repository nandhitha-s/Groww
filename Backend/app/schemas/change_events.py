import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel

from app.enums import ChangeEventSeverity, ChangeEventType


class ChangeEventSummary(BaseModel):
    """Provider-independent, database-independent view of one detected
    meaningful change (Phase 6A). Never exposes a SQLAlchemy model."""

    stock_id: uuid.UUID
    symbol: str
    type: ChangeEventType
    severity: ChangeEventSeverity
    title: str
    description: str
    old_value: Decimal
    new_value: Decimal
    detected_at: datetime


class ChangeEventListItem(BaseModel):
    """One row of the persisted ChangeEvent history (Phase 9's
    GET /api/changes) -- unlike ChangeEventSummary above (a transient
    detection result returned from the "seen" flow), this reflects a
    already-persisted row: it carries the row's own id and acknowledgement
    state, and is read back from the database rather than freshly detected."""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    stock_id: uuid.UUID
    symbol: str
    watchlist_id: uuid.UUID | None
    type: ChangeEventType
    severity: ChangeEventSeverity
    title: str
    description: str | None
    old_value: Decimal | None
    new_value: Decimal | None
    detected_at: datetime
    acknowledged_at: datetime | None


class ChangeEventListResponse(BaseModel):
    items: list[ChangeEventListItem]
    limit: int
    count: int
