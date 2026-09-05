"""Phase 6C: ephemeral Market Signals.

Deliberately separate from Phase 6A's change_engine.py: a Market Signal is a
condition read directly off the *current* quote (e.g. "trading near today's
low") -- it has no concept of a user's previous baseline, is never persisted
as a ChangeEvent, and never affects UserStockState/MarketSnapshot. It exists
purely to give the Dashboard something useful to say about a stock's current
conditions even when nothing crossed a personalized meaningful-change
threshold.

Pluggable by design, mirroring change_engine.py: `detect_signals` returns a
list of `DetectedSignal`, one per rule that fired. Adding a future rule
(e.g. NEAR_DAY_HIGH) means adding another pure `evaluate_*` function and
appending its result here -- the persistence/API layers never change.
"""

import uuid
from dataclasses import dataclass
from decimal import Decimal

from app.enums import ChangeEventSeverity, MarketSignalType
from app.schemas.market_data import QuoteResponse

# A fixed 1% band -- not a user-configurable threshold (this isn't
# personalized, so it doesn't go through change_engine.resolve_thresholds).
NEAR_DAY_EXTREME_RATIO = Decimal("1.01")


@dataclass(frozen=True)
class DetectedSignal:
    """One ephemeral market-condition signal. Never persisted -- built and
    handed straight to the API response for the current request only."""

    stock_id: uuid.UUID
    symbol: str
    type: MarketSignalType
    severity: ChangeEventSeverity
    title: str
    description: str


def _format_price(value: Decimal) -> str:
    return f"₹{value:,.2f}"


def evaluate_near_day_low(
    *,
    stock_id: uuid.UUID,
    symbol: str,
    current_price: Decimal | None,
    day_low: Decimal | None,
) -> DetectedSignal | None:
    """`current_price <= day_low * 1.01`. Never fabricated: a missing or
    non-positive day_low (the provider didn't supply one) simply produces no
    signal, rather than inventing a comparison."""
    if current_price is None or day_low is None or day_low <= 0:
        return None
    if current_price > day_low * NEAR_DAY_EXTREME_RATIO:
        return None

    return DetectedSignal(
        stock_id=stock_id,
        symbol=symbol,
        type=MarketSignalType.NEAR_DAY_LOW,
        severity=ChangeEventSeverity.MEDIUM,
        title=f"{symbol} is near today’s low",
        description=(
            f"{symbol} is trading at {_format_price(current_price)}, close to today's low of "
            f"{_format_price(day_low)}."
        ),
    )


def detect_signals(*, stock_id: uuid.UUID, symbol: str, quote: QuoteResponse) -> list[DetectedSignal]:
    signals: list[DetectedSignal] = []

    near_low = evaluate_near_day_low(
        stock_id=stock_id,
        symbol=symbol,
        current_price=quote.price,
        day_low=quote.day_low,
    )
    if near_low is not None:
        signals.append(near_low)

    return signals
