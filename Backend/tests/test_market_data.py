from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from app.config import get_settings
from app.database import get_db
from app.main import app
from app.providers.fyers import FYERSProvider
from app.providers.market_data import (
    InvalidQueryError,
    InvalidSymbolError,
    MalformedProviderResponseError,
    MarketDataProvider,
    ProviderAuthenticationError,
    ProviderUnavailableError,
    RateLimitedError,
)
from app.providers.yfinance_provider import YFinanceProvider
from app.schemas.market_data import HistoricalCandle, HistoricalResponse, HistoryPeriod, QuoteResponse, StockSearchResult
from app.services.market_data import MarketDataService, get_market_data_service
from yfinance.exceptions import YFRateLimitError, YFTickerMissingError

SEARCH_URL = "/api/market-data/search"
QUOTE_URL = "/api/market-data/quote/{symbol}"
HISTORY_URL = "/api/market-data/history/{symbol}"


@pytest.fixture(autouse=True)
def _reset_symbol_cache():
    """FYERSProvider caches the symbol master at the class level (shared
    across requests on purpose). Reset it around every test so tests never
    leak state into each other."""
    FYERSProvider._symbol_cache = None
    yield
    FYERSProvider._symbol_cache = None


def _register(client, email="alice@example.com", password="correct-horse-battery", name="Alice"):
    response = client.post(
        "/api/auth/register", json={"name": name, "email": email, "password": password}
    )
    assert response.status_code == 201, response.text
    return response


# ---------------------------------------------------------------------------
# API-level tests: routes + service, with a fake MarketDataProvider injected
# via dependency override. These never touch fyers_apiv3 or the network.
# ---------------------------------------------------------------------------


class _FakeProvider(MarketDataProvider):
    def __init__(self, *, search_result=None, quote_result=None, history_result=None, error=None):
        self._search_result = search_result
        self._quote_result = quote_result
        self._history_result = history_result
        self._error = error

    def search_stocks(self, query: str) -> list[StockSearchResult]:
        if self._error:
            raise self._error
        return self._search_result or []

    def get_quote(self, symbol: str) -> QuoteResponse:
        if self._error:
            raise self._error
        return self._quote_result

    def get_history(self, symbol: str, period: HistoryPeriod) -> HistoricalResponse:
        if self._error:
            raise self._error
        return self._history_result


@pytest.fixture()
def market_client(client, request):
    """Overrides the market-data service dependency with a fake provider
    for the duration of one test. Pass fake-provider kwargs via
    `request.param` (a dict), or leave unset for a client with no override
    configured yet (call `set_provider` on the returned object)."""

    class _Handle:
        def set_provider(self, **kwargs):
            provider = _FakeProvider(**kwargs)
            app.dependency_overrides[get_market_data_service] = lambda: MarketDataService(provider)

    handle = _Handle()
    yield client, handle
    app.dependency_overrides.pop(get_market_data_service, None)


def test_search_requires_authentication(market_client):
    client, handle = market_client
    handle.set_provider(search_result=[])
    response = client.get(SEARCH_URL, params={"q": "RELI"})
    assert response.status_code == 401


def test_quote_requires_authentication(market_client):
    client, _ = market_client
    response = client.get(QUOTE_URL.format(symbol="RELIANCE"))
    assert response.status_code == 401


def test_history_requires_authentication(market_client):
    client, _ = market_client
    response = client.get(HISTORY_URL.format(symbol="RELIANCE"))
    assert response.status_code == 401


def test_search_success(market_client):
    client, handle = market_client
    _register(client)
    handle.set_provider(
        search_result=[
            StockSearchResult(
                symbol="RELIANCE",
                company_name="RELIANCE INDUSTRIES LTD",
                exchange="NSE",
                instrument_key="NSE:RELIANCE-EQ",
            )
        ]
    )

    response = client.get(SEARCH_URL, params={"q": "reliance"})
    assert response.status_code == 200
    body = response.json()
    assert body == [
        {
            "symbol": "RELIANCE",
            "company_name": "RELIANCE INDUSTRIES LTD",
            "exchange": "NSE",
            "instrument_key": "NSE:RELIANCE-EQ",
        }
    ]


def test_search_empty_query_rejected_by_schema(market_client):
    client, handle = market_client
    _register(client)
    handle.set_provider(search_result=[])
    response = client.get(SEARCH_URL, params={"q": ""})
    assert response.status_code == 422


def test_search_whitespace_query_rejected_by_provider(market_client):
    client, handle = market_client
    _register(client)
    handle.set_provider(error=InvalidQueryError("Search query must not be empty."))
    response = client.get(SEARCH_URL, params={"q": " "})
    assert response.status_code == 422


def test_search_provider_failure_returns_503(market_client):
    client, handle = market_client
    _register(client)
    handle.set_provider(error=ProviderUnavailableError("down"))
    response = client.get(SEARCH_URL, params={"q": "reliance"})
    assert response.status_code == 503
    assert "FYERS" not in response.text  # no raw provider internals leaked


def test_quote_success_and_normalized_shape(market_client):
    client, handle = market_client
    _register(client)
    quote = QuoteResponse(
        symbol="RELIANCE",
        price=Decimal("2456.75"),
        previous_close=Decimal("2440.00"),
        day_high=Decimal("2460.00"),
        day_low=Decimal("2430.50"),
        volume=1234567,
        average_volume=None,
        change=Decimal("16.75"),
        change_percent=Decimal("0.69"),
        timestamp=datetime(2026, 1, 5, 10, 0, tzinfo=timezone.utc),
        data_source="FYERS",
        is_delayed=False,
    )
    handle.set_provider(quote_result=quote)

    response = client.get(QUOTE_URL.format(symbol="reliance"))
    assert response.status_code == 200
    body = response.json()
    assert body["symbol"] == "RELIANCE"
    assert body["price"] == "2456.75"
    assert body["average_volume"] is None
    assert body["data_source"] == "FYERS"
    assert "fyToken" not in body  # no provider-specific fields leaked


def test_quote_invalid_symbol_returns_404(market_client):
    client, handle = market_client
    _register(client)
    handle.set_provider(error=InvalidSymbolError("NOTREAL"))
    response = client.get(QUOTE_URL.format(symbol="NOTREAL"))
    assert response.status_code == 404


def test_quote_provider_failure_returns_503(market_client):
    client, handle = market_client
    _register(client)
    handle.set_provider(error=ProviderUnavailableError("down"))
    response = client.get(QUOTE_URL.format(symbol="RELIANCE"))
    assert response.status_code == 503


def test_quote_auth_error_returns_502(market_client):
    client, handle = market_client
    _register(client)
    handle.set_provider(error=ProviderAuthenticationError("bad token"))
    response = client.get(QUOTE_URL.format(symbol="RELIANCE"))
    assert response.status_code == 502


def test_quote_rate_limited_returns_429(market_client):
    client, handle = market_client
    _register(client)
    handle.set_provider(error=RateLimitedError("slow down"))
    response = client.get(QUOTE_URL.format(symbol="RELIANCE"))
    assert response.status_code == 429


def test_history_success(market_client):
    client, handle = market_client
    _register(client)
    history = HistoricalResponse(
        symbol="RELIANCE",
        period=HistoryPeriod.ONE_MONTH,
        data_source="FYERS",
        candles=[
            HistoricalCandle(
                timestamp=datetime(2026, 1, 5, 4, 0, tzinfo=timezone.utc),
                open=Decimal("2440"),
                high=Decimal("2460"),
                low=Decimal("2430"),
                close=Decimal("2456.75"),
                volume=1234567,
            )
        ],
    )
    handle.set_provider(history_result=history)

    response = client.get(HISTORY_URL.format(symbol="reliance"), params={"period": "1M"})
    assert response.status_code == 200
    body = response.json()
    assert body["period"] == "1M"
    assert len(body["candles"]) == 1
    assert body["candles"][0]["close"] == "2456.75"


def test_history_invalid_period_rejected_by_schema(market_client):
    client, handle = market_client
    _register(client)
    handle.set_provider(history_result=None)
    response = client.get(HISTORY_URL.format(symbol="RELIANCE"), params={"period": "6M"})
    assert response.status_code == 422


def test_history_invalid_symbol_returns_404(market_client):
    client, handle = market_client
    _register(client)
    handle.set_provider(error=InvalidSymbolError("NOTREAL"))
    response = client.get(HISTORY_URL.format(symbol="NOTREAL"))
    assert response.status_code == 404


def test_history_provider_failure_returns_503(market_client):
    client, handle = market_client
    _register(client)
    handle.set_provider(error=ProviderUnavailableError("down"))
    response = client.get(HISTORY_URL.format(symbol="RELIANCE"))
    assert response.status_code == 503


# ---------------------------------------------------------------------------
# Provider-level unit tests: FYERSProvider itself, mocking requests/fyersModel
# so no test depends on a live FYERS API call or the network.
# ---------------------------------------------------------------------------

_SAMPLE_CSV = (
    "101000000013061,RELIANCE INDUSTRIES LTD,0,1,0.1,INE002A01018,0915-1530:,2026-09-03,,"
    "NSE:RELIANCE-EQ,10,10,13061,RELIANCE,13061,-1.0,XX,101000000013061,None,1,3.2\n"
    "101000000016921,TATA CONSULTANCY SERV LT,0,1,0.1,INE467B01029,0915-1530:,2026-09-03,,"
    "NSE:TCS-EQ,10,10,16921,TCS,16921,-1.0,XX,101000000016921,None,1,2.0\n"
)


class _FakeResponse:
    def __init__(self, text, status_code=200):
        self.text = text
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            import requests

            raise requests.HTTPError(response=self)


def _provider_with_settings(app_id="APPID", access_token="TOKEN"):
    settings = get_settings().model_copy(update={"fyers_app_id": app_id, "fyers_access_token": access_token})
    return FYERSProvider(settings)


def test_provider_search_parses_real_shaped_csv(monkeypatch):
    import requests

    monkeypatch.setattr(requests, "get", lambda *a, **k: _FakeResponse(_SAMPLE_CSV))
    provider = _provider_with_settings()

    results = provider.search_stocks("reliance")

    assert len(results) == 1
    assert results[0].symbol == "RELIANCE"
    assert results[0].company_name == "RELIANCE INDUSTRIES LTD"
    assert results[0].exchange == "NSE"
    assert results[0].instrument_key == "NSE:RELIANCE-EQ"


def test_provider_search_empty_query_raises(monkeypatch):
    import requests

    monkeypatch.setattr(requests, "get", lambda *a, **k: _FakeResponse(_SAMPLE_CSV))
    provider = _provider_with_settings()

    with pytest.raises(InvalidQueryError):
        provider.search_stocks("   ")


def test_provider_search_network_failure_raises_provider_unavailable(monkeypatch):
    import requests

    def _boom(*a, **k):
        raise requests.ConnectionError("no network")

    monkeypatch.setattr(requests, "get", _boom)
    provider = _provider_with_settings()

    with pytest.raises(ProviderUnavailableError):
        provider.search_stocks("reliance")


def test_provider_get_quote_success(monkeypatch):
    import requests

    monkeypatch.setattr(requests, "get", lambda *a, **k: _FakeResponse(_SAMPLE_CSV))
    provider = _provider_with_settings()

    fake_quote_response = {
        "s": "ok",
        "d": [
            {
                "n": "NSE:RELIANCE-EQ",
                "s": "ok",
                "v": {
                    "lp": 2456.75,
                    "prev_close_price": 2440.0,
                    "high_price": 2460.0,
                    "low_price": 2430.5,
                    "volume": 1234567,
                    "ch": 16.75,
                    "chp": 0.69,
                    "tt": 1767600000,
                },
            }
        ],
    }
    provider._client = type("FakeClient", (), {"quotes": staticmethod(lambda data: fake_quote_response)})()

    quote = provider.get_quote("reliance")

    assert quote.symbol == "RELIANCE"
    assert quote.price == Decimal("2456.75")
    assert quote.previous_close == Decimal("2440.0")
    assert quote.change == Decimal("16.75")
    assert quote.data_source == "FYERS"
    assert quote.average_volume is None


def test_provider_get_quote_computes_change_when_provider_omits_it(monkeypatch):
    import requests

    monkeypatch.setattr(requests, "get", lambda *a, **k: _FakeResponse(_SAMPLE_CSV))
    provider = _provider_with_settings()

    fake_quote_response = {
        "s": "ok",
        "d": [{"n": "NSE:RELIANCE-EQ", "s": "ok", "v": {"lp": 110.0, "prev_close_price": 100.0}}],
    }
    provider._client = type("FakeClient", (), {"quotes": staticmethod(lambda data: fake_quote_response)})()

    quote = provider.get_quote("reliance")

    assert quote.change == Decimal("10.0")
    assert quote.change_percent == Decimal("10.0")


def test_provider_get_quote_unknown_symbol_raises(monkeypatch):
    import requests

    monkeypatch.setattr(requests, "get", lambda *a, **k: _FakeResponse(_SAMPLE_CSV))
    provider = _provider_with_settings()

    with pytest.raises(InvalidSymbolError):
        provider.get_quote("NOTREAL")


def test_provider_get_quote_auth_error_raises(monkeypatch):
    import requests

    monkeypatch.setattr(requests, "get", lambda *a, **k: _FakeResponse(_SAMPLE_CSV))
    provider = _provider_with_settings()

    fake_error_response = {"s": "error", "code": -16, "message": "Invalid Authorization Token"}
    provider._client = type("FakeClient", (), {"quotes": staticmethod(lambda data: fake_error_response)})()

    with pytest.raises(ProviderAuthenticationError):
        provider.get_quote("reliance")


def test_provider_get_quote_malformed_response_raises(monkeypatch):
    import requests

    monkeypatch.setattr(requests, "get", lambda *a, **k: _FakeResponse(_SAMPLE_CSV))
    provider = _provider_with_settings()

    provider._client = type("FakeClient", (), {"quotes": staticmethod(lambda data: {"s": "ok", "d": [{"s": "ok", "v": {}}]})})()

    with pytest.raises(MalformedProviderResponseError):
        provider.get_quote("reliance")


def test_provider_get_quote_not_configured_raises_unavailable(monkeypatch):
    import requests

    monkeypatch.setattr(requests, "get", lambda *a, **k: _FakeResponse(_SAMPLE_CSV))
    provider = _provider_with_settings(app_id=None, access_token=None)

    with pytest.raises(ProviderUnavailableError):
        provider.get_quote("reliance")


def test_provider_get_history_success(monkeypatch):
    import requests

    monkeypatch.setattr(requests, "get", lambda *a, **k: _FakeResponse(_SAMPLE_CSV))
    provider = _provider_with_settings()

    fake_history_response = {
        "s": "ok",
        "candles": [[1767600000, 2440.0, 2460.0, 2430.0, 2456.75, 1234567]],
    }
    provider._client = type("FakeClient", (), {"history": staticmethod(lambda data: fake_history_response)})()

    history = provider.get_history("reliance", HistoryPeriod.ONE_MONTH)

    assert history.symbol == "RELIANCE"
    assert len(history.candles) == 1
    assert history.candles[0].close == Decimal("2456.75")
    assert history.candles[0].timestamp.tzinfo is not None


def test_provider_get_history_malformed_candle_raises(monkeypatch):
    import requests

    monkeypatch.setattr(requests, "get", lambda *a, **k: _FakeResponse(_SAMPLE_CSV))
    provider = _provider_with_settings()

    fake_history_response = {"s": "ok", "candles": [[1767600000, 2440.0]]}
    provider._client = type("FakeClient", (), {"history": staticmethod(lambda data: fake_history_response)})()

    with pytest.raises(MalformedProviderResponseError):
        provider.get_history("reliance", HistoryPeriod.ONE_MONTH)


# ---------------------------------------------------------------------------
# Provider-level unit tests: YFinanceProvider itself, mocking yfinance's
# `yf.Search`/`yf.Ticker` so no test depends on the network or Yahoo Finance
# actually being reachable.
# ---------------------------------------------------------------------------

import pandas as pd  # noqa: E402  (grouped near its only usage, below)

import app.providers.yfinance_provider as yfp


class _FakeFastInfo:
    _CAMEL_TO_SNAKE = {
        "previousClose": "previous_close",
        "dayHigh": "day_high",
        "dayLow": "day_low",
        "lastVolume": "last_volume",
        "threeMonthAverageVolume": "three_month_average_volume",
    }

    def __init__(self, values: dict, *, raise_on_access: Exception | None = None):
        self._values = values
        self._raise_on_access = raise_on_access

    @property
    def last_price(self):
        if self._raise_on_access:
            raise self._raise_on_access
        return self._values["last_price"]

    def get(self, key, default=None):
        return self._values.get(self._CAMEL_TO_SNAKE.get(key, key), default)


class _FakeTicker:
    def __init__(self, fast_info=None, history_frame=None):
        self._fast_info = fast_info
        self._history_frame = history_frame

    @property
    def fast_info(self):
        return self._fast_info

    def history(self, period=None, interval=None):
        return self._history_frame


def _history_frame(rows: list[tuple]) -> "pd.DataFrame":
    index = pd.DatetimeIndex([r[0] for r in rows], tz="Asia/Kolkata")
    return pd.DataFrame(
        {
            "Open": [r[1] for r in rows],
            "High": [r[2] for r in rows],
            "Low": [r[3] for r in rows],
            "Close": [r[4] for r in rows],
            "Volume": [r[5] for r in rows],
        },
        index=index,
    )


def test_yf_search_success(monkeypatch):
    class _FakeSearch:
        def __init__(self, query, max_results=20):
            self.quotes = [
                {
                    "exchange": "NSI",
                    "symbol": "RELIANCE.NS",
                    "longname": "Reliance Industries Limited",
                    "shortname": "RELIANCE",
                },
                {"exchange": "NYQ", "symbol": "AAPL", "longname": "Apple Inc."},  # non-Indian, filtered out
            ]

    monkeypatch.setattr(yfp.yf, "Search", _FakeSearch)
    provider = YFinanceProvider()

    results = provider.search_stocks("reliance")

    assert len(results) == 1
    assert results[0].symbol == "RELIANCE"
    assert results[0].company_name == "Reliance Industries Limited"
    assert results[0].exchange == "NSE"
    assert results[0].instrument_key == "RELIANCE.NS"


def test_yf_search_empty_query_raises():
    provider = YFinanceProvider()
    with pytest.raises(InvalidQueryError):
        provider.search_stocks("   ")


def test_yf_search_provider_failure_raises_unavailable(monkeypatch):
    def _boom(*a, **k):
        raise ConnectionError("no network")

    monkeypatch.setattr(yfp.yf, "Search", _boom)
    provider = YFinanceProvider()

    with pytest.raises(ProviderUnavailableError):
        provider.search_stocks("reliance")


def test_yf_search_malformed_response_raises(monkeypatch):
    class _FakeSearch:
        def __init__(self, query, max_results=20):
            self.quotes = "not-a-list"

    monkeypatch.setattr(yfp.yf, "Search", _FakeSearch)
    provider = YFinanceProvider()

    with pytest.raises(MalformedProviderResponseError):
        provider.search_stocks("reliance")


def test_yf_get_quote_success(monkeypatch):
    fast_info = _FakeFastInfo(
        {
            "last_price": 2456.75,
            "previous_close": 2440.0,
            "day_high": 2460.0,
            "day_low": 2430.5,
            "last_volume": 1234567,
            "three_month_average_volume": 5000000,
        }
    )
    monkeypatch.setattr(yfp.yf, "Ticker", lambda symbol: _FakeTicker(fast_info=fast_info))
    provider = YFinanceProvider()

    quote = provider.get_quote("reliance")

    assert quote.symbol == "RELIANCE"
    assert quote.price == Decimal("2456.75")
    assert quote.previous_close == Decimal("2440.0")
    assert quote.change == Decimal("16.75")
    assert quote.data_source == "Yahoo Finance"
    assert quote.is_delayed is True


def test_yf_get_quote_invalid_symbol_raises(monkeypatch):
    fast_info = _FakeFastInfo({}, raise_on_access=KeyError("currentTradingPeriod"))
    monkeypatch.setattr(yfp.yf, "Ticker", lambda symbol: _FakeTicker(fast_info=fast_info))
    provider = YFinanceProvider()

    with pytest.raises(InvalidSymbolError):
        provider.get_quote("NOTREAL")


def test_yf_get_quote_provider_failure_raises_unavailable(monkeypatch):
    fast_info = _FakeFastInfo({}, raise_on_access=ConnectionError("no network"))
    monkeypatch.setattr(yfp.yf, "Ticker", lambda symbol: _FakeTicker(fast_info=fast_info))
    provider = YFinanceProvider()

    with pytest.raises(ProviderUnavailableError):
        provider.get_quote("RELIANCE")


def test_yf_get_quote_rate_limited_raises(monkeypatch):
    fast_info = _FakeFastInfo({}, raise_on_access=YFRateLimitError())
    monkeypatch.setattr(yfp.yf, "Ticker", lambda symbol: _FakeTicker(fast_info=fast_info))
    provider = YFinanceProvider()

    with pytest.raises(RateLimitedError):
        provider.get_quote("RELIANCE")


def test_yf_get_quote_malformed_response_raises(monkeypatch):
    fast_info = _FakeFastInfo({"last_price": 2456.75, "previous_close": object()})
    monkeypatch.setattr(yfp.yf, "Ticker", lambda symbol: _FakeTicker(fast_info=fast_info))
    provider = YFinanceProvider()

    with pytest.raises(MalformedProviderResponseError):
        provider.get_quote("RELIANCE")


def test_yf_get_history_success(monkeypatch):
    frame = _history_frame(
        [(pd.Timestamp("2026-01-05 09:15"), 2440.0, 2460.0, 2430.0, 2456.75, 1234567)]
    )
    monkeypatch.setattr(yfp.yf, "Ticker", lambda symbol: _FakeTicker(history_frame=frame))
    provider = YFinanceProvider()

    history = provider.get_history("reliance", HistoryPeriod.ONE_MONTH)

    assert history.symbol == "RELIANCE"
    assert history.data_source == "Yahoo Finance"
    assert len(history.candles) == 1
    assert history.candles[0].close == Decimal("2456.75")
    assert history.candles[0].timestamp.tzinfo is not None


def test_yf_get_history_invalid_symbol_raises(monkeypatch):
    empty_frame = pd.DataFrame()
    monkeypatch.setattr(yfp.yf, "Ticker", lambda symbol: _FakeTicker(history_frame=empty_frame))
    provider = YFinanceProvider()

    with pytest.raises(InvalidSymbolError):
        provider.get_history("NOTREAL", HistoryPeriod.ONE_MONTH)


def test_yf_get_history_provider_failure_raises_unavailable(monkeypatch):
    class _BoomTicker:
        def history(self, period=None, interval=None):
            raise ConnectionError("no network")

    monkeypatch.setattr(yfp.yf, "Ticker", lambda symbol: _BoomTicker())
    provider = YFinanceProvider()

    with pytest.raises(ProviderUnavailableError):
        provider.get_history("RELIANCE", HistoryPeriod.ONE_MONTH)


def test_yf_get_history_ticker_missing_falls_back_then_raises_invalid_symbol(monkeypatch):
    class _MissingTicker:
        def history(self, period=None, interval=None):
            raise YFTickerMissingError("NOTREAL.NS", "no data found")

    monkeypatch.setattr(yfp.yf, "Ticker", lambda symbol: _MissingTicker())
    provider = YFinanceProvider()

    with pytest.raises(InvalidSymbolError):
        provider.get_history("NOTREAL", HistoryPeriod.ONE_MONTH)


def test_yf_get_history_malformed_candle_raises(monkeypatch):
    frame = pd.DataFrame(
        {"Open": [2440.0]}, index=pd.DatetimeIndex([pd.Timestamp("2026-01-05")], tz="Asia/Kolkata")
    )
    monkeypatch.setattr(yfp.yf, "Ticker", lambda symbol: _FakeTicker(history_frame=frame))
    provider = YFinanceProvider()

    with pytest.raises(MalformedProviderResponseError):
        provider.get_history("RELIANCE", HistoryPeriod.ONE_MONTH)


def test_yf_get_history_rate_limited_raises(monkeypatch):
    class _RateLimitedTicker:
        def history(self, period=None, interval=None):
            raise YFRateLimitError()

    monkeypatch.setattr(yfp.yf, "Ticker", lambda symbol: _RateLimitedTicker())
    provider = YFinanceProvider()

    with pytest.raises(RateLimitedError):
        provider.get_history("RELIANCE", HistoryPeriod.ONE_MONTH)
