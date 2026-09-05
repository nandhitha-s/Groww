"""The market-data provider abstraction.

Routes and MarketDataService only ever depend on this interface -- never on
a specific provider (FYERS or otherwise). This keeps provider-specific
response shapes, auth schemes, and SDKs entirely out of the rest of the app.
"""

from abc import ABC, abstractmethod

from app.schemas.market_data import HistoricalResponse, HistoryPeriod, QuoteResponse, StockSearchResult


class MarketDataError(Exception):
    """Base class for all market-data provider failures."""


class ProviderUnavailableError(MarketDataError):
    """The provider is not configured, or could not be reached at all."""


class ProviderAuthenticationError(MarketDataError):
    """The provider rejected our credentials/token."""


class InvalidQueryError(MarketDataError):
    """The search query is invalid (e.g. empty/too short)."""


class InvalidSymbolError(MarketDataError):
    """The requested symbol is unknown to the provider."""

    def __init__(self, symbol: str):
        self.symbol = symbol
        super().__init__(f"Unknown or invalid symbol: {symbol}")


class MalformedProviderResponseError(MarketDataError):
    """The provider returned a response we could not parse safely.

    Raised instead of guessing at missing/renamed fields -- this app must
    never fabricate a price or other market value.
    """


class RateLimitedError(MarketDataError):
    """The provider is rate-limiting our requests."""


class MarketDataProvider(ABC):
    """Interface every market-data provider (FYERS, or a future one) must
    implement. Return values are always the provider-independent schemas
    in app.schemas.market_data -- never a raw provider payload."""

    @abstractmethod
    def search_stocks(self, query: str) -> list[StockSearchResult]:
        """Search for tradable instruments matching a free-text query."""

    @abstractmethod
    def get_quote(self, symbol: str) -> QuoteResponse:
        """Fetch the current quote for a symbol."""

    @abstractmethod
    def get_history(self, symbol: str, period: HistoryPeriod) -> HistoricalResponse:
        """Fetch historical candles for a symbol over a fixed period."""
