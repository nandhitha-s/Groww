import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.database import get_db
from app.models.stock import Stock
from app.models.user import User
from app.models.watchlist import Watchlist
from app.schemas.watchlists import (
    AddStockRequest,
    ReorderStocksRequest,
    WatchlistCreate,
    WatchlistDetail,
    WatchlistStock,
    WatchlistSummary,
    WatchlistUpdate,
)
from app.services import watchlists as watchlist_service

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
