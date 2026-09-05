import uuid
from datetime import datetime

from pydantic import BaseModel

from app.enums import ChangeEventSeverity, MarketSignalType


class MarketSignalSummary(BaseModel):
    """Provider-independent view of one ephemeral Market Signal (Phase 6C).
    Deliberately NOT ChangeEventSummary: no old_value/new_value (there is no
    "since you last checked" comparison here), and this is never backed by
    a persisted ChangeEvent row -- see app/services/market_signals.py."""

    stock_id: uuid.UUID
    symbol: str
    type: MarketSignalType
    severity: ChangeEventSeverity
    title: str
    description: str
    detected_at: datetime
