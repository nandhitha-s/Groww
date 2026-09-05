from app.providers.market_data import MarketDataProvider
from app.providers.yfinance_provider import YFinanceProvider
from app.schemas.market_data import HistoricalResponse, HistoryPeriod, QuoteResponse, StockSearchResult


class MarketDataService:
    """Orchestration layer between API routes and a MarketDataProvider.

    Route handlers must never call a provider (e.g. YFinanceProvider) or a
    provider's underlying library directly -- only this service.
    """

    def __init__(self, provider: MarketDataProvider):
        self._provider = provider

    def search_stocks(self, query: str) -> list[StockSearchResult]:
        return self._provider.search_stocks(query)

    def get_quote(self, symbol: str) -> QuoteResponse:
        return self._provider.get_quote(symbol)

    def get_history(self, symbol: str, period: HistoryPeriod) -> HistoricalResponse:
        return self._provider.get_history(symbol, period)


def get_market_data_service() -> MarketDataService:
    """FastAPI dependency. Swapping the market-data provider later means
    changing only this function."""
    return MarketDataService(YFinanceProvider())
