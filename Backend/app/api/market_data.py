from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_current_user
from app.models.user import User
from app.providers.market_data import (
    InvalidQueryError,
    InvalidSymbolError,
    MalformedProviderResponseError,
    MarketDataError,
    ProviderAuthenticationError,
    ProviderUnavailableError,
    RateLimitedError,
)
from app.schemas.market_data import HistoricalResponse, HistoryPeriod, QuoteResponse, StockSearchResult
from app.services.market_data import MarketDataService, get_market_data_service

router = APIRouter(prefix="/api/market-data", tags=["market-data"])

_UNAUTHENTICATED = {401: {"description": "Not authenticated"}}
_ERROR_RESPONSES = {
    404: {"description": "Symbol not found"},
    422: {"description": "Invalid search query or period"},
    429: {"description": "Provider is rate-limiting requests"},
    502: {"description": "Provider returned an unexpected response, or rejected our credentials"},
    503: {"description": "Market-data provider is unavailable or not configured"},
}


def _map_market_data_error(exc: MarketDataError) -> HTTPException:
    if isinstance(exc, InvalidQueryError):
        return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
    if isinstance(exc, InvalidSymbolError):
        return HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Unknown symbol: {exc.symbol}"
        )
    if isinstance(exc, RateLimitedError):
        return HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests to the market data provider. Try again shortly.",
        )
    if isinstance(exc, (ProviderAuthenticationError, MalformedProviderResponseError)):
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Market data provider returned an unexpected response.",
        )
    # ProviderUnavailableError and any other MarketDataError.
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Market data is temporarily unavailable.",
    )


@router.get(
    "/search",
    response_model=list[StockSearchResult],
    responses={**_UNAUTHENTICATED, **_ERROR_RESPONSES},
)
def search_stocks(
    q: str = Query(..., min_length=1, max_length=50, description="Symbol or company name to search for"),
    current_user: User = Depends(get_current_user),
    service: MarketDataService = Depends(get_market_data_service),
) -> list[StockSearchResult]:
    try:
        return service.search_stocks(q)
    except MarketDataError as exc:
        raise _map_market_data_error(exc)


@router.get(
    "/quote/{symbol}",
    response_model=QuoteResponse,
    responses={**_UNAUTHENTICATED, **_ERROR_RESPONSES},
)
def get_quote(
    symbol: str,
    current_user: User = Depends(get_current_user),
    service: MarketDataService = Depends(get_market_data_service),
) -> QuoteResponse:
    try:
        return service.get_quote(symbol)
    except MarketDataError as exc:
        raise _map_market_data_error(exc)


@router.get(
    "/history/{symbol}",
    response_model=HistoricalResponse,
    responses={**_UNAUTHENTICATED, **_ERROR_RESPONSES},
)
def get_history(
    symbol: str,
    period: HistoryPeriod = Query(HistoryPeriod.ONE_MONTH, description="Historical lookback window"),
    current_user: User = Depends(get_current_user),
    service: MarketDataService = Depends(get_market_data_service),
) -> HistoricalResponse:
    try:
        return service.get_history(symbol, period)
    except MarketDataError as exc:
        raise _map_market_data_error(exc)
