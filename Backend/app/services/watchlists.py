import uuid

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models.stock import Stock
from app.models.user import User
from app.models.watchlist import Watchlist
from app.models.watchlist_item import WatchlistItem


class WatchlistNotFoundError(Exception):
    """Raised when a watchlist doesn't exist, or doesn't belong to the
    requesting user -- both cases are treated identically so ownership
    never leaks via a different error."""


class DuplicateWatchlistNameError(Exception):
    """Raised when the user already has a watchlist with this name."""


class DuplicateStockError(Exception):
    """Raised when the stock is already in this watchlist."""


class StockNotInWatchlistError(Exception):
    """Raised when the symbol isn't currently in this watchlist."""


class InvalidReorderError(Exception):
    """Raised when a reorder payload doesn't match the watchlist's actual
    stocks (missing, extra, or foreign IDs)."""


def _owned_watchlist_stmt(watchlist_id: uuid.UUID, user: User):
    return select(Watchlist).where(Watchlist.id == watchlist_id, Watchlist.user_id == user.id)


def _get_owned_watchlist(db: Session, *, watchlist_id: uuid.UUID, user: User) -> Watchlist:
    watchlist = db.execute(_owned_watchlist_stmt(watchlist_id, user)).scalar_one_or_none()
    if watchlist is None:
        raise WatchlistNotFoundError()
    return watchlist


def count_stocks(db: Session, *, watchlist_id: uuid.UUID) -> int:
    return db.execute(
        select(func.count(WatchlistItem.id)).where(WatchlistItem.watchlist_id == watchlist_id)
    ).scalar_one()


def list_watchlists(db: Session, *, user: User) -> list[tuple[Watchlist, int]]:
    """Return (watchlist, stock_count) pairs for the user, most-recently
    updated first, in a single query (no N+1)."""
    stock_count = (
        select(func.count(WatchlistItem.id))
        .where(WatchlistItem.watchlist_id == Watchlist.id)
        .correlate(Watchlist)
        .scalar_subquery()
    )
    rows = db.execute(
        select(Watchlist, stock_count.label("stock_count"))
        .where(Watchlist.user_id == user.id)
        .order_by(Watchlist.updated_at.desc())
    ).all()
    return [(row[0], row[1]) for row in rows]


def get_watchlist_detail(db: Session, *, watchlist_id: uuid.UUID, user: User) -> Watchlist:
    """Load a watchlist with its items and stocks eagerly (2 extra queries
    total via selectinload, regardless of item count -- no N+1)."""
    watchlist = db.execute(
        _owned_watchlist_stmt(watchlist_id, user).options(
            selectinload(Watchlist.items).selectinload(WatchlistItem.stock)
        )
    ).scalar_one_or_none()
    if watchlist is None:
        raise WatchlistNotFoundError()
    return watchlist


def create_watchlist(db: Session, *, user: User, name: str) -> Watchlist:
    existing = db.execute(
        select(Watchlist).where(Watchlist.user_id == user.id, Watchlist.name == name)
    ).scalar_one_or_none()
    if existing is not None:
        raise DuplicateWatchlistNameError()

    watchlist = Watchlist(user_id=user.id, name=name)
    db.add(watchlist)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise DuplicateWatchlistNameError() from exc

    db.commit()
    db.refresh(watchlist)
    return watchlist


def update_watchlist(db: Session, *, watchlist_id: uuid.UUID, user: User, name: str) -> Watchlist:
    watchlist = _get_owned_watchlist(db, watchlist_id=watchlist_id, user=user)

    if name != watchlist.name:
        existing = db.execute(
            select(Watchlist).where(
                Watchlist.user_id == user.id,
                Watchlist.name == name,
                Watchlist.id != watchlist_id,
            )
        ).scalar_one_or_none()
        if existing is not None:
            raise DuplicateWatchlistNameError()

        watchlist.name = name
        try:
            db.flush()
        except IntegrityError as exc:
            db.rollback()
            raise DuplicateWatchlistNameError() from exc

    db.commit()
    db.refresh(watchlist)
    return watchlist


def delete_watchlist(db: Session, *, watchlist_id: uuid.UUID, user: User) -> None:
    """Delete the watchlist. Its WatchlistItems cascade-delete (see the
    Watchlist->WatchlistItem FK); the underlying Stock rows are untouched --
    WatchlistItem->Stock cascade only runs the other way (deleting a Stock
    removes its WatchlistItems, never vice versa)."""
    watchlist = _get_owned_watchlist(db, watchlist_id=watchlist_id, user=user)
    db.delete(watchlist)
    db.commit()


def add_stock(db: Session, *, watchlist_id: uuid.UUID, user: User, symbol: str) -> WatchlistItem:
    """Add a stock (by symbol) to the watchlist, creating a minimal
    placeholder Stock row if one doesn't exist yet. Never fabricates
    company_name/exchange -- those stay null until a later market-data
    phase enriches the record."""
    watchlist = _get_owned_watchlist(db, watchlist_id=watchlist_id, user=user)

    stock = db.execute(select(Stock).where(Stock.symbol == symbol)).scalar_one_or_none()
    if stock is None:
        stock = Stock(symbol=symbol)
        db.add(stock)
        try:
            db.flush()
        except IntegrityError:
            # Lost a race with a concurrent insert of the same new symbol;
            # the rollback expires `watchlist` too, but it still exists in
            # the DB and reloads transparently on next attribute access.
            db.rollback()
            stock = db.execute(select(Stock).where(Stock.symbol == symbol)).scalar_one()

    existing_item = db.execute(
        select(WatchlistItem).where(
            WatchlistItem.watchlist_id == watchlist.id, WatchlistItem.stock_id == stock.id
        )
    ).scalar_one_or_none()
    if existing_item is not None:
        raise DuplicateStockError()

    next_position = (
        db.execute(
            select(func.coalesce(func.max(WatchlistItem.position), -1)).where(
                WatchlistItem.watchlist_id == watchlist.id
            )
        ).scalar_one()
        + 1
    )

    item = WatchlistItem(watchlist_id=watchlist.id, stock_id=stock.id, position=next_position)
    db.add(item)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise DuplicateStockError() from exc

    db.commit()
    db.refresh(item)
    db.refresh(stock)
    return item


def remove_stock(db: Session, *, watchlist_id: uuid.UUID, user: User, symbol: str) -> None:
    """Remove the WatchlistItem for this symbol (never the Stock itself),
    then compact remaining positions so they stay contiguous from 0."""
    watchlist = _get_owned_watchlist(db, watchlist_id=watchlist_id, user=user)

    stock = db.execute(select(Stock).where(Stock.symbol == symbol)).scalar_one_or_none()
    item = (
        db.execute(
            select(WatchlistItem).where(
                WatchlistItem.watchlist_id == watchlist.id, WatchlistItem.stock_id == stock.id
            )
        ).scalar_one_or_none()
        if stock is not None
        else None
    )
    if item is None:
        raise StockNotInWatchlistError()

    removed_position = item.position
    db.delete(item)
    db.flush()

    remaining = (
        db.execute(
            select(WatchlistItem)
            .where(
                WatchlistItem.watchlist_id == watchlist.id,
                WatchlistItem.position > removed_position,
            )
            .order_by(WatchlistItem.position)
        )
        .scalars()
        .all()
    )
    for remaining_item in remaining:
        remaining_item.position -= 1

    db.commit()


def reorder_stocks(
    db: Session, *, watchlist_id: uuid.UUID, user: User, stock_ids: list[uuid.UUID]
) -> Watchlist:
    """Reassign zero-based positions according to stock_ids' order. The
    payload must name exactly the watchlist's current stocks -- no more, no
    fewer, no foreign IDs."""
    watchlist = _get_owned_watchlist(db, watchlist_id=watchlist_id, user=user)

    items = (
        db.execute(select(WatchlistItem).where(WatchlistItem.watchlist_id == watchlist.id))
        .scalars()
        .all()
    )
    items_by_stock_id = {item.stock_id: item for item in items}

    if len(stock_ids) != len(set(stock_ids)):
        raise InvalidReorderError("stock_ids must not contain duplicates")

    if set(stock_ids) != set(items_by_stock_id.keys()):
        raise InvalidReorderError(
            "stock_ids must be exactly the set of stocks currently in this watchlist"
        )

    for index, stock_id in enumerate(stock_ids):
        items_by_stock_id[stock_id].position = index

    db.commit()

    return get_watchlist_detail(db, watchlist_id=watchlist_id, user=user)
