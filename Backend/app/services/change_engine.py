"""Phase 6A: the deterministic, rule-based Meaningful Change Engine.

Compares a user's last-seen baseline (`UserStockState`, established by
Phase 5A/5B) against a newly observed quote, and decides whether a
PRICE_MOVE and/or VOLUME_SPIKE signal crossed the user's configured
threshold. Purely rule-based -- no AI/LLM, no external calls, no randomness.
Every function below is a small, pure computation over Decimal/int values,
independently testable with no DB/HTTP involved (only `resolve_thresholds`
touches the database, since it has to look up `UserPreference`).

Naming note: the task/product language for the two signals is "PRICE_MOVE"
and "VOLUME_SPIKE". The existing `ChangeEventType` enum (Phase 1) already
has equivalent members -- `PRICE_CHANGE` and `VOLUME_SPIKE` -- so those are
what get persisted; nothing new was added to the enum (Step 5: reuse
existing values rather than redesigning).

Pluggable by design: `detect_changes` returns a list of `DetectedChange`,
one entry per signal that actually fired. Adding a future signal type
(news, earnings, ...) means adding another pure `evaluate_*` function and
appending its result in `detect_changes` -- the persistence/API layers
never need to change to support a new signal type.
"""

import uuid
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.enums import ChangeEventSeverity, ChangeEventType
from app.models.user_preference import UserPreference
from app.models.user_stock_state import UserStockState
from app.schemas.market_data import QuoteResponse

# Mirrors UserPreference's own column defaults (Numeric(5,2), 5.00 / 100.00)
# -- used only when a user has no UserPreference row at all yet. Step 14:
# never require configuring thresholds just to use the engine.
DEFAULT_PRICE_CHANGE_THRESHOLD = Decimal("5.00")
DEFAULT_VOLUME_SPIKE_THRESHOLD = Decimal("100.00")


@dataclass(frozen=True)
class ChangeThresholds:
    price_change_threshold: Decimal
    volume_spike_threshold: Decimal


@dataclass(frozen=True)
class DetectedChange:
    """One meaningful-change signal, fully self-contained and ready to
    persist as a ChangeEvent (or return via the API) -- never a SQLAlchemy
    model itself."""

    stock_id: uuid.UUID
    symbol: str
    type: ChangeEventType
    severity: ChangeEventSeverity
    title: str
    description: str
    old_value: Decimal
    new_value: Decimal


def resolve_thresholds(db: Session, *, user_id: uuid.UUID) -> ChangeThresholds:
    """Looks up the user's UserPreference (Phase 1's existing model -- never
    a second preference model). Falls back to the application defaults
    when the user has no preference row yet, rather than requiring one."""
    preference = db.execute(
        select(UserPreference).where(UserPreference.user_id == user_id)
    ).scalar_one_or_none()
    if preference is None:
        return ChangeThresholds(
            price_change_threshold=DEFAULT_PRICE_CHANGE_THRESHOLD,
            volume_spike_threshold=DEFAULT_VOLUME_SPIKE_THRESHOLD,
        )
    return ChangeThresholds(
        price_change_threshold=preference.price_change_threshold,
        volume_spike_threshold=preference.volume_spike_threshold,
    )


def _severity_for_magnitude(magnitude: Decimal, threshold: Decimal) -> ChangeEventSeverity | None:
    """Shared MEDIUM/HIGH severity rule for both signal types (Step 6):
    below threshold -> no event; [threshold, 2x threshold) -> MEDIUM;
    >= 2x threshold -> HIGH."""
    if magnitude < threshold:
        return None
    if magnitude < threshold * 2:
        return ChangeEventSeverity.MEDIUM
    return ChangeEventSeverity.HIGH


def _format_price(value: Decimal) -> str:
    return f"₹{value:,.2f}"


def _format_volume(value: int) -> str:
    if value >= 1_000_000:
        return f"{value / 1_000_000:.1f}M"
    if value >= 1_000:
        return f"{value / 1_000:.1f}K"
    return str(value)


def evaluate_price_move(
    *,
    stock_id: uuid.UUID,
    symbol: str,
    previous_price: Decimal,
    current_price: Decimal,
    threshold: Decimal,
) -> DetectedChange | None:
    """Step 3. `percentage_change = (current - previous) / previous * 100`;
    meaningful when `abs(percentage_change) >= threshold`. Works identically
    for upward and downward movement (severity/title just adapt the
    wording)."""
    if previous_price == 0:
        return None  # a zero baseline can't produce a meaningful percentage

    percentage_change = ((current_price - previous_price) / previous_price) * Decimal(100)
    magnitude = abs(percentage_change)
    severity = _severity_for_magnitude(magnitude, threshold)
    if severity is None:
        return None

    if percentage_change > 0:
        title = f"{symbol} moved {magnitude:.1f}% since you last checked"
        description = (
            f"{symbol} increased from {_format_price(previous_price)} to "
            f"{_format_price(current_price)} since your last check."
        )
    else:
        title = f"{symbol} fell {magnitude:.1f}% since you last checked"
        description = (
            f"{symbol} decreased from {_format_price(previous_price)} to "
            f"{_format_price(current_price)} since your last check."
        )

    return DetectedChange(
        stock_id=stock_id,
        symbol=symbol,
        type=ChangeEventType.PRICE_CHANGE,
        severity=severity,
        title=title,
        description=description,
        old_value=previous_price,
        new_value=current_price,
    )


def evaluate_volume_spike(
    *,
    stock_id: uuid.UUID,
    symbol: str,
    current_volume: int | None,
    average_volume: int | None,
    threshold: Decimal,
) -> DetectedChange | None:
    """Step 4. `excess_percentage = (current - average) / average * 100`;
    meaningful when `excess_percentage >= threshold` (i.e. current volume is
    at least `1 + threshold/100` times average). Never fabricated when
    volume or average volume is missing or zero."""
    if current_volume is None or average_volume is None or average_volume == 0:
        return None

    excess_percentage = (
        (Decimal(current_volume) - Decimal(average_volume)) / Decimal(average_volume)
    ) * Decimal(100)
    severity = _severity_for_magnitude(excess_percentage, threshold)
    if severity is None:
        return None

    title = f"{symbol} volume is {excess_percentage:.0f}% above average"
    description = (
        f"Trading volume increased from an average of {_format_volume(average_volume)} shares "
        f"to {_format_volume(current_volume)} shares."
    )

    return DetectedChange(
        stock_id=stock_id,
        symbol=symbol,
        type=ChangeEventType.VOLUME_SPIKE,
        severity=severity,
        title=title,
        description=description,
        old_value=Decimal(average_volume),
        new_value=Decimal(current_volume),
    )


def detect_changes(
    *,
    stock_id: uuid.UUID,
    symbol: str,
    previous_state: UserStockState | None,
    quote: QuoteResponse,
    thresholds: ChangeThresholds,
) -> list[DetectedChange]:
    """The engine's entry point (Step 9). Returns [] -- never fabricating a
    change -- when there is no previous_state at all (Step 8: the first
    observation of a stock establishes the user's baseline only, uniformly
    across every signal type, even though volume-spike's own formula
    doesn't structurally need a prior baseline -- keeping "first visit =
    baseline only" simple and consistent avoids noisy first impressions).
    """
    if previous_state is None or previous_state.last_seen_price is None:
        return []

    changes: list[DetectedChange] = []

    price_change = evaluate_price_move(
        stock_id=stock_id,
        symbol=symbol,
        previous_price=previous_state.last_seen_price,
        current_price=quote.price,
        threshold=thresholds.price_change_threshold,
    )
    if price_change is not None:
        changes.append(price_change)

    volume_change = evaluate_volume_spike(
        stock_id=stock_id,
        symbol=symbol,
        current_volume=quote.volume,
        average_volume=quote.average_volume,
        threshold=thresholds.volume_spike_threshold,
    )
    if volume_change is not None:
        changes.append(volume_change)

    return changes
