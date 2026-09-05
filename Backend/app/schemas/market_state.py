import uuid
from datetime import datetime

from pydantic import BaseModel

from app.schemas.change_events import ChangeEventSummary
from app.schemas.market_signals import MarketSignalSummary


class WatchlistMarketStateResult(BaseModel):
    """Provider-independent summary of a "record this watchlist's current
    market state, and mark it as seen" operation. Never exposes raw
    provider error text or SQLAlchemy models -- `failed_symbols` names only
    the stocks whose quote could not be observed this time.

    `detected`/`changes` (Phase 6A): meaningful changes found while
    comparing this observation against each stock's previous UserStockState
    baseline, persisted as ChangeEvent rows. Integrated into this existing
    operation rather than a separate endpoint, since change detection must
    happen against the *same* observation this call is already persisting
    -- see app/services/change_engine.py and market_snapshots.py.

    `market_signals` (Phase 6C): ephemeral, current-quote-only conditions
    (e.g. "near today's low") computed from the same quotes -- deliberately
    NOT persisted as ChangeEvents and NOT counted in `detected`/`changes`,
    which stay scoped to personalized, persisted meaningful changes only.
    See app/services/market_signals.py."""

    watchlist_id: uuid.UUID
    processed: int
    successful: int
    failed: int
    failed_symbols: list[str]
    seen_at: datetime
    detected: int
    changes: list[ChangeEventSummary]
    market_signals: list[MarketSignalSummary] = []
