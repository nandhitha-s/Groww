import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.database import get_db
from app.models.stock import Stock
from app.models.user import User
from app.models.watchlist import Watchlist
from app.schemas.change_events import ChangeEventSummary
from app.schemas.market_signals import MarketSignalSummary
from app.schemas.market_state import WatchlistMarketStateResult
from app.schemas.watchlists import (
    AddStockRequest,
    ReorderStocksRequest,
    WatchlistCreate,
    WatchlistDetail,
    WatchlistStock,
    WatchlistSummary,
    WatchlistUpdate,
)
from app.services import market_snapshots as market_snapshot_service
from app.services import watchlists as watchlist_service
from app.services.market_data import MarketDataService, get_market_data_service

router = APIRouter(prefix="/api/watchlists", tags=["watchlists"])

# Documented on every route: all of them require authentication.
_UNAUTHENTICATED = {401: {"description": "Not authenticated"}}
_NOT_FOUND = {404: {"description": "Watchlist not found, or not owned by the current user"}}
_DUPLICATE_NAME = {409: {"description": "A watchlist with this name already exists"}}
_DUPLICATE_STOCK = {409: {"description": "This stock is already in the watchlist"}}
_INVALID_REORDER = {
    400: {"description": "stock_ids does not match the watchlist's current stocks exactly"}
}


def _watchlist_not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Watchlist not found")


def _to_summary(watchlist: Watchlist, stock_count: int) -> WatchlistSummary:
    return WatchlistSummary(
        id=watchlist.id,
        name=watchlist.name,
        stock_count=stock_count,
        created_at=watchlist.created_at,
        updated_at=watchlist.updated_at,
    )


def _to_stock(item) -> WatchlistStock:
    return WatchlistStock(
        id=item.stock.id,
        symbol=item.stock.symbol,
        company_name=item.stock.company_name,
        exchange=item.stock.exchange,
        position=item.position,
    )


def _to_detail(watchlist: Watchlist) -> WatchlistDetail:
    return WatchlistDetail(
        id=watchlist.id,
        name=watchlist.name,
        stocks=[_to_stock(item) for item in watchlist.items],
        created_at=watchlist.created_at,
        updated_at=watchlist.updated_at,
    )


@router.get("", response_model=list[WatchlistSummary], responses={**_UNAUTHENTICATED})
def list_watchlists(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[WatchlistSummary]:
    rows = watchlist_service.list_watchlists(db, user=current_user)
    return [_to_summary(watchlist, count) for watchlist, count in rows]


@router.post(
    "",
    response_model=WatchlistSummary,
    status_code=status.HTTP_201_CREATED,
    responses={**_UNAUTHENTICATED, **_DUPLICATE_NAME},
)
def create_watchlist(
    payload: WatchlistCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WatchlistSummary:
    try:
        watchlist = watchlist_service.create_watchlist(db, user=current_user, name=payload.name)
    except watchlist_service.DuplicateWatchlistNameError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A watchlist with this name already exists"
        )

    return _to_summary(watchlist, stock_count=0)


@router.get(
    "/{watchlist_id}",
    response_model=WatchlistDetail,
    responses={**_UNAUTHENTICATED, **_NOT_FOUND},
)
def get_watchlist(
    watchlist_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WatchlistDetail:
    try:
        watchlist = watchlist_service.get_watchlist_detail(
            db, watchlist_id=watchlist_id, user=current_user
        )
    except watchlist_service.WatchlistNotFoundError:
        raise _watchlist_not_found()

    return _to_detail(watchlist)


@router.patch(
    "/{watchlist_id}",
    response_model=WatchlistSummary,
    responses={**_UNAUTHENTICATED, **_NOT_FOUND, **_DUPLICATE_NAME},
)
def update_watchlist(
    watchlist_id: uuid.UUID,
    payload: WatchlistUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WatchlistSummary:
    try:
        watchlist = watchlist_service.update_watchlist(
            db, watchlist_id=watchlist_id, user=current_user, name=payload.name
        )
    except watchlist_service.WatchlistNotFoundError:
        raise _watchlist_not_found()
    except watchlist_service.DuplicateWatchlistNameError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A watchlist with this name already exists"
        )

    stock_count = watchlist_service.count_stocks(db, watchlist_id=watchlist.id)
    return _to_summary(watchlist, stock_count)


@router.delete(
    "/{watchlist_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={**_UNAUTHENTICATED, **_NOT_FOUND},
)
def delete_watchlist(
    watchlist_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    try:
        watchlist_service.delete_watchlist(db, watchlist_id=watchlist_id, user=current_user)
    except watchlist_service.WatchlistNotFoundError:
        raise _watchlist_not_found()


@router.post(
    "/{watchlist_id}/stocks",
    response_model=WatchlistStock,
    status_code=status.HTTP_201_CREATED,
    responses={**_UNAUTHENTICATED, **_NOT_FOUND, **_DUPLICATE_STOCK},
)
def add_stock(
    watchlist_id: uuid.UUID,
    payload: AddStockRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WatchlistStock:
    try:
        item = watchlist_service.add_stock(
            db, watchlist_id=watchlist_id, user=current_user, symbol=payload.symbol
        )
    except watchlist_service.WatchlistNotFoundError:
        raise _watchlist_not_found()
    except watchlist_service.DuplicateStockError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This stock is already in the watchlist"
        )

    return _to_stock(item)


@router.delete(
    "/{watchlist_id}/stocks/{symbol}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        **_UNAUTHENTICATED,
        404: {"description": "Watchlist not found/owned, or stock not in this watchlist"},
    },
)
def remove_stock(
    watchlist_id: uuid.UUID,
    symbol: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    try:
        watchlist_service.remove_stock(
            db,
            watchlist_id=watchlist_id,
            user=current_user,
            symbol=Stock.normalize_symbol(symbol),
        )
    except watchlist_service.WatchlistNotFoundError:
        raise _watchlist_not_found()
    except watchlist_service.StockNotInWatchlistError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Stock not found in this watchlist"
        )


@router.patch(
    "/{watchlist_id}/stocks/reorder",
    response_model=WatchlistDetail,
    responses={**_UNAUTHENTICATED, **_NOT_FOUND, **_INVALID_REORDER},
)
def reorder_stocks(
    watchlist_id: uuid.UUID,
    payload: ReorderStocksRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WatchlistDetail:
    try:
        watchlist = watchlist_service.reorder_stocks(
            db, watchlist_id=watchlist_id, user=current_user, stock_ids=payload.stock_ids
        )
    except watchlist_service.WatchlistNotFoundError:
        raise _watchlist_not_found()
    except watchlist_service.InvalidReorderError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    return _to_detail(watchlist)


@router.post(
    "/{watchlist_id}/market-state/seen",
    response_model=WatchlistMarketStateResult,
    responses={**_UNAUTHENTICATED, **_NOT_FOUND},
)
def record_watchlist_market_state_seen(
    watchlist_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    market_data_service: MarketDataService = Depends(get_market_data_service),
) -> WatchlistMarketStateResult:
    """Record the watchlist's current market state (a MarketSnapshot per
    successfully-observed stock), detect any meaningful changes against each
    stock's previous baseline (Phase 6A -- app/services/change_engine.py),
    detect any ephemeral current-quote Market Signals (Phase 6C --
    app/services/market_signals.py), and explicitly mark it as seen by the
    current user (their UserStockState). See app/services/market_snapshots.py
    for the full semantics."""
    try:
        results, seen_at, changes, signals = market_snapshot_service.record_watchlist_market_state(
            db, market_data_service, user=current_user, watchlist_id=watchlist_id
        )
    except market_snapshot_service.WatchlistNotFoundError:
        raise _watchlist_not_found()

    failed_symbols = [r.symbol for r in results if not r.success]
    change_summaries = [
        ChangeEventSummary(
            stock_id=change.stock_id,
            symbol=change.symbol,
            type=change.type,
            severity=change.severity,
            title=change.title,
            description=change.description,
            old_value=change.old_value,
            new_value=change.new_value,
            detected_at=seen_at,
        )
        for change in changes
    ]
    signal_summaries = [
        MarketSignalSummary(
            stock_id=signal.stock_id,
            symbol=signal.symbol,
            type=signal.type,
            severity=signal.severity,
            title=signal.title,
            description=signal.description,
            detected_at=seen_at,
        )
        for signal in signals
    ]
    return WatchlistMarketStateResult(
        watchlist_id=watchlist_id,
        processed=len(results),
        successful=len(results) - len(failed_symbols),
        failed=len(failed_symbols),
        failed_symbols=failed_symbols,
        seen_at=seen_at,
        detected=len(change_summaries),
        changes=change_summaries,
        market_signals=signal_summaries,
    )
