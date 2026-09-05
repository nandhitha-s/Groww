"""Recording market observations and per-user "last seen" state (Phase 5A).

Two distinct concepts, kept deliberately separate -- see the module-level
docstrings on `MarketSnapshot` and `UserStockState` themselves:

- A `MarketSnapshot` is "what did the market look like at this instant" --
  written every time we successfully observe a quote, regardless of who (if
  anyone) is looking. History is never deleted or overwritten.
- A `UserStockState` is "what market state did THIS user last actually see"
  -- exactly one row per (user_id, stock_id), updated only by the explicit
  `record_user_stock_seen` operation, never as a side effect of merely
  fetching a quote.

Phase 6A adds one more step to `record_watchlist_market_state`, between
persisting the snapshot and overwriting the baseline: compare the new
observation against the *previous* `UserStockState` (before it's
overwritten) via `app.services.change_engine`, and persist any resulting
`ChangeEvent` rows. The actual "is this meaningful" comparison logic lives
entirely in `change_engine.py` -- this module only owns reading/locking the
previous state and persisting whatever the engine decides.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, selectinload

from app.models.change_event import ChangeEvent
from app.models.market_snapshot import MarketSnapshot
from app.models.stock import Stock
from app.models.user import User
from app.models.user_stock_state import UserStockState
from app.models.watchlist import Watchlist
from app.models.watchlist_item import WatchlistItem
from app.providers.market_data import MarketDataError
from app.schemas.market_data import QuoteResponse
from app.services import change_engine, market_signals
from app.services.change_engine import DetectedChange
from app.services.market_data import MarketDataService
from app.services.market_signals import DetectedSignal


class WatchlistNotFoundError(Exception):
    """Raised when the watchlist doesn't exist, or isn't owned by the
    requesting user -- both cases treated identically so ownership is never
    revealed to a non-owner."""


@dataclass(frozen=True)
class StockObservationResult:
    """Outcome of attempting to observe one stock's current market state.
    `error` is for internal/test visibility only -- the API layer must never
    forward raw provider error text to the client (see Step 7's "do not
    return provider-specific structures")."""

    stock_id: uuid.UUID
    symbol: str
    success: bool
    error: str | None = None


def _get_owned_watchlist_with_stocks(db: Session, *, watchlist_id: uuid.UUID, user: User) -> Watchlist:
    watchlist = db.execute(
        select(Watchlist)
        .where(Watchlist.id == watchlist_id, Watchlist.user_id == user.id)
        .options(selectinload(Watchlist.items).selectinload(WatchlistItem.stock))
    ).scalar_one_or_none()
    if watchlist is None:
        raise WatchlistNotFoundError()
    return watchlist


def record_snapshot(db: Session, *, stock_id: uuid.UUID, quote: QuoteResponse) -> MarketSnapshot:
    """Stage (via `db.add`, not committed here) a new MarketSnapshot row
    from a real provider quote.

    Every field is taken as-is from `quote` -- never fabricated. Where the
    provider didn't supply a value (or, as with `market_cap`, where the
    current `QuoteResponse` contract doesn't carry it at all -- Phase 4A/4B
    is intentionally left untouched by this phase), the column is left
    NULL, which the schema already allows.

    Deduplication: deliberately NOT enforced by a database constraint here.
    `MarketSnapshot` has no unique constraint on (stock_id, timestamp) --
    only the `ix_market_snapshots_stock_id_timestamp` index for query
    performance -- because two genuinely distinct observations can share a
    timestamp only down to whatever precision the provider/clock offers,
    and a provider is free to report the same `timestamp` for two calls a
    few seconds apart without those observations being meaningless
    duplicates. The practical deduplication boundary in this phase is
    behavioral, not a DB constraint: `record_watchlist_market_state` is only
    ever invoked once per explicit "user is looking at this watchlist right
    now" action (never from unrelated quote fetches, and never on a timer),
    so naturally-adjacent duplicate snapshots from rapid accidental
    re-invocation are a product-level concern for a future phase (e.g. a
    short client-side cooldown on the "seen" button), not something this
    phase silently drops -- every real observation this phase is asked to
    record is preserved, matching Step 12's requirement that snapshot
    history is never thinned out from underneath `UserStockState`.
    """
    snapshot = MarketSnapshot(
        stock_id=stock_id,
        price=quote.price,
        previous_close=quote.previous_close,
        day_high=quote.day_high,
        day_low=quote.day_low,
        volume=quote.volume,
        average_volume=quote.average_volume,
        market_cap=None,
        timestamp=quote.timestamp,
        data_source=quote.data_source,
        is_delayed=quote.is_delayed,
    )
    db.add(snapshot)
    return snapshot


def record_user_stock_seen(
    db: Session,
    *,
    user_id: uuid.UUID,
    stock_id: uuid.UUID,
    price: Decimal | None,
    volume: int | None,
    seen_at: datetime,
) -> None:
    """The explicit "this user actually saw this market state" operation.

    Must be called only when that is genuinely true -- never as a side
    effect of an unrelated quote fetch (e.g. a plain GET /quote/{symbol}
    call must never reach this function).

    Uses a single atomic `INSERT ... ON CONFLICT (user_id, stock_id) DO
    UPDATE` against the existing `uq_user_stock_states_user_id_stock_id`
    constraint, rather than a "SELECT, then INSERT-if-missing" pair of
    statements: two concurrent requests for the same user+stock (e.g. two
    open tabs) both reading "no row yet" and both attempting to INSERT
    would otherwise race on that unique constraint. The upsert makes
    "create the first baseline" and "update the existing baseline" the same
    atomic statement, so at most one row per (user_id, stock_id) is
    guaranteed by the database itself, not by an application-level check.
    """
    stmt = pg_insert(UserStockState).values(
        user_id=user_id,
        stock_id=stock_id,
        last_seen_price=price,
        last_seen_volume=volume,
        last_seen_at=seen_at,
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_user_stock_states_user_id_stock_id",
        set_={
            "last_seen_price": stmt.excluded.last_seen_price,
            "last_seen_volume": stmt.excluded.last_seen_volume,
            "last_seen_at": stmt.excluded.last_seen_at,
        },
    )
    db.execute(stmt)


def _get_previous_state_for_update(
    db: Session, *, user_id: uuid.UUID, stock_id: uuid.UUID
) -> UserStockState | None:
    """Reads the user's current baseline for this stock -- BEFORE
    `record_user_stock_seen` overwrites it -- so the change engine compares
    against what the user actually last saw, not against the observation
    it's about to record.

    `.with_for_update()` takes a row lock (when a row exists) that is held
    until this transaction commits/rolls back. That closes the concurrency
    gap a plain SELECT would leave open: two simultaneous requests for the
    same (user, stock) -- e.g. two open tabs both hitting "seen" -- would
    otherwise both read the same stale baseline and could both detect and
    persist the same change twice. With the lock, the second request's
    SELECT blocks until the first commits, then correctly reads the
    already-updated baseline and (per record_watchlist_market_state's own
    logic below) finds nothing new to report. A row that doesn't exist yet
    (first-ever observation) has nothing to lock -- Phase 5A's existing
    atomic upsert in `record_user_stock_seen` is what keeps that case race
    -free.
    """
    # `.populate_existing()`: `record_user_stock_seen` writes via a raw Core
    # upsert, which never syncs an already-identity-mapped ORM instance of
    # this same row. A fresh per-request Session (the normal case) never
    # hits this, but nothing here should depend on that -- without it, a
    # second observation of the same stock within one longer-lived session
    # (e.g. this exact multi-call sequence under test) could read back a
    # stale previous price instead of the one just written.
    return db.execute(
        select(UserStockState)
        .where(UserStockState.user_id == user_id, UserStockState.stock_id == stock_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()


def _persist_change_event(
    db: Session,
    *,
    user_id: uuid.UUID,
    watchlist_id: uuid.UUID,
    change: DetectedChange,
    detected_at: datetime,
) -> ChangeEvent:
    """Stages (via `db.add`, not committed here) one ChangeEvent row from a
    DetectedChange. `old_value`/`new_value` are stored as strings (the
    column type Phase 1 already provides -- Text, not Numeric) built from
    `str(Decimal)`, never a float, so the exact value is preserved."""
    event = ChangeEvent(
        user_id=user_id,
        stock_id=change.stock_id,
        watchlist_id=watchlist_id,
        type=change.type,
        severity=change.severity,
        title=change.title,
        description=change.description,
        old_value=str(change.old_value),
        new_value=str(change.new_value),
        detected_at=detected_at,
    )
    db.add(event)
    return event


def record_watchlist_market_state(
    db: Session,
    market_data_service: MarketDataService,
    *,
    user: User,
    watchlist_id: uuid.UUID,
) -> tuple[list[StockObservationResult], datetime, list[DetectedChange], list[DetectedSignal]]:
    """Process every stock currently in a user's watchlist:

    1. Verify ownership (raises WatchlistNotFoundError otherwise).
    2. Fetch a current quote per stock -- external I/O, done with no
       write-transaction open; each stock's provider failure is caught and
       isolated, never fabricated, never allowed to fail the whole batch.
    3. For every successful quote, in one DB transaction committed once at
       the end: persist a MarketSnapshot, compare the quote against the
       stock's *previous* UserStockState via the Phase 6A change engine and
       persist any resulting ChangeEvent(s), then update UserStockState.
       That order matters -- the comparison must read the old baseline
       before it's overwritten (Step 10). A stock with no previous
       UserStockState yet (first-ever observation) never produces a
       ChangeEvent (Step 8) -- only a fresh baseline.

    If persistence itself fails (a real DB error, not a provider error),
    the exception propagates and `get_db`'s dependency rolls the whole
    transaction back -- no partial snapshot/event/state writes survive.

    Phase 6C: alongside the ChangeEvent comparison, each successful quote is
    also passed through `market_signals.detect_signals` -- a second, purely
    quote-based check (no previous-state comparison, nothing persisted).
    Its results are only ever returned, never written to the database.

    Returns (per-stock results, the single `seen_at`/`detected_at` timestamp
    applied to everything in this call, every ChangeEvent detected, and
    every ephemeral Market Signal detected).
    """
    watchlist = _get_owned_watchlist_with_stocks(db, watchlist_id=watchlist_id, user=user)
    stocks: list[Stock] = [item.stock for item in watchlist.items]

    quotes: dict[uuid.UUID, QuoteResponse] = {}
    results: list[StockObservationResult] = []
    for stock in stocks:
        try:
            quotes[stock.id] = market_data_service.get_quote(stock.symbol)
            results.append(StockObservationResult(stock.id, stock.symbol, success=True))
        except MarketDataError as exc:
            results.append(StockObservationResult(stock.id, stock.symbol, success=False, error=str(exc)))

    seen_at = datetime.now(timezone.utc)
    thresholds = change_engine.resolve_thresholds(db, user_id=user.id)

    detected_changes: list[DetectedChange] = []
    detected_signals: list[DetectedSignal] = []
    for stock in stocks:
        quote = quotes.get(stock.id)
        if quote is None:
            continue

        record_snapshot(db, stock_id=stock.id, quote=quote)

        previous_state = _get_previous_state_for_update(db, user_id=user.id, stock_id=stock.id)
        changes = change_engine.detect_changes(
            stock_id=stock.id,
            symbol=stock.symbol,
            previous_state=previous_state,
            quote=quote,
            thresholds=thresholds,
        )
        for change in changes:
            _persist_change_event(
                db,
                user_id=user.id,
                watchlist_id=watchlist.id,
                change=change,
                detected_at=seen_at,
            )
        detected_changes.extend(changes)

        # Phase 6C: ephemeral, current-quote-only -- computed from the same
        # `quote` already in hand, no extra provider call, nothing staged
        # for persistence (contrast with `_persist_change_event` above).
        detected_signals.extend(
            market_signals.detect_signals(stock_id=stock.id, symbol=stock.symbol, quote=quote)
        )

        record_user_stock_seen(
            db,
            user_id=user.id,
            stock_id=stock.id,
            price=quote.price,
            volume=quote.volume,
            seen_at=seen_at,
        )

    db.commit()

    return results, seen_at, detected_changes, detected_signals
