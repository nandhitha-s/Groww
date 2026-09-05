import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.enums import MarketSignalType
from app.main import app
from app.models.change_event import ChangeEvent
from app.providers.market_data import MarketDataProvider
from app.schemas.market_data import HistoricalResponse, HistoryPeriod, QuoteResponse, StockSearchResult
from app.services import market_signals
from app.services.market_data import MarketDataService, get_market_data_service

WATCHLISTS_URL = "/api/watchlists"


# ---------------------------------------------------------------------------
# Pure unit tests -- no DB, no HTTP (mirrors test_change_engine.py's style)
# ---------------------------------------------------------------------------


def test_current_price_near_day_low_produces_near_day_low_signal():
    # Real numbers from the reported screenshot: 800.00 <= 796.10 * 1.01
    signal = market_signals.evaluate_near_day_low(
        stock_id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        symbol="TATATECH",
        current_price=Decimal("800.00"),
        day_low=Decimal("796.10"),
    )

    assert signal is not None
    assert signal.type == MarketSignalType.NEAR_DAY_LOW
    assert signal.severity.value == "MEDIUM"
    assert signal.symbol == "TATATECH"
    assert "near today" in signal.title.lower()


def test_current_price_exactly_equal_to_day_low_produces_signal():
    signal = market_signals.evaluate_near_day_low(
        stock_id=uuid.UUID("00000000-0000-0000-0000-000000000002"),
        symbol="WIPRO",
        current_price=Decimal("176.40"),
        day_low=Decimal("176.40"),
    )

    assert signal is not None
    assert signal.type == MarketSignalType.NEAR_DAY_LOW


def test_price_comfortably_above_day_low_produces_no_signal():
    signal = market_signals.evaluate_near_day_low(
        stock_id=uuid.UUID("00000000-0000-0000-0000-000000000003"),
        symbol="RELIANCE",
        current_price=Decimal("2970.00"),
        day_low=Decimal("2900.00"),
    )

    assert signal is None


@pytest.mark.parametrize("day_low", [None, Decimal("0"), Decimal("-5")])
def test_missing_or_invalid_day_low_produces_no_signal(day_low):
    signal = market_signals.evaluate_near_day_low(
        stock_id=uuid.UUID("00000000-0000-0000-0000-000000000004"),
        symbol="TATATECH",
        current_price=Decimal("800.00"),
        day_low=day_low,
    )

    assert signal is None


def test_missing_current_price_produces_no_signal():
    signal = market_signals.evaluate_near_day_low(
        stock_id=uuid.UUID("00000000-0000-0000-0000-000000000005"),
        symbol="TATATECH",
        current_price=None,
        day_low=Decimal("796.10"),
    )

    assert signal is None


# ---------------------------------------------------------------------------
# Integration: the real "seen" endpoint, real detection pipeline, fake quote
# ---------------------------------------------------------------------------


def _register(client, email="alice@example.com", name="Alice", password="correct-horse-battery"):
    response = client.post(
        "/api/auth/register", json={"name": name, "email": email, "password": password}
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_watchlist(client, name="Energy"):
    response = client.post(WATCHLISTS_URL, json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


def _add_stock(client, watchlist_id, symbol):
    response = client.post(f"{WATCHLISTS_URL}/{watchlist_id}/stocks", json={"symbol": symbol})
    assert response.status_code == 201, response.text
    return response.json()


def _seen(client, watchlist_id):
    return client.post(f"{WATCHLISTS_URL}/{watchlist_id}/market-state/seen")


def _quote(
    symbol,
    price,
    day_low,
    day_high=None,
    previous_close=None,
    volume=1_000_000,
    average_volume=900_000,
) -> QuoteResponse:
    price_d = Decimal(price)
    return QuoteResponse(
        symbol=symbol,
        price=price_d,
        previous_close=Decimal(previous_close) if previous_close else price_d,
        day_high=Decimal(day_high) if day_high else price_d,
        day_low=Decimal(day_low) if day_low is not None else None,
        volume=volume,
        average_volume=average_volume,
        change=Decimal("0"),
        change_percent=Decimal("0"),
        timestamp=datetime.now(timezone.utc),
        data_source="Yahoo Finance",
        is_delayed=True,
    )


class _FakeProvider(MarketDataProvider):
    def __init__(self, quotes: dict[str, QuoteResponse]):
        self._quotes = quotes

    def search_stocks(self, query: str) -> list[StockSearchResult]:
        return []

    def get_quote(self, symbol: str) -> QuoteResponse:
        return self._quotes[symbol]

    def get_history(self, symbol: str, period: HistoryPeriod) -> HistoricalResponse:
        raise NotImplementedError


def _use_provider(quotes: dict[str, QuoteResponse]):
    app.dependency_overrides[get_market_data_service] = lambda: MarketDataService(_FakeProvider(quotes))


@pytest.fixture(autouse=True)
def _reset_market_data_override():
    yield
    app.dependency_overrides.pop(get_market_data_service, None)


def test_seen_response_includes_market_signal_for_stock_near_its_day_low(client, db_session):
    _register(client)
    watchlist_id = _create_watchlist(client)["id"]
    _add_stock(client, watchlist_id, "TATATECH")
    _use_provider({"TATATECH": _quote("TATATECH", price="800.00", day_low="796.10", day_high="830.95")})

    response = _seen(client, watchlist_id)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["detected"] == 0
    assert body["changes"] == []
    assert len(body["market_signals"]) == 1
    signal = body["market_signals"][0]
    assert signal["symbol"] == "TATATECH"
    assert signal["type"] == "NEAR_DAY_LOW"
    assert signal["severity"] == "MEDIUM"

    # Ephemeral: never persisted as a ChangeEvent (Step 6).
    change_event_count = db_session.execute(select(func.count()).select_from(ChangeEvent)).scalar_one()
    assert change_event_count == 0


def test_seen_response_has_no_market_signals_when_nothing_qualifies(client):
    _register(client)
    watchlist_id = _create_watchlist(client)["id"]
    _add_stock(client, watchlist_id, "RELIANCE")
    _use_provider({"RELIANCE": _quote("RELIANCE", price="2970.00", day_low="2900.00", day_high="2990.00")})

    response = _seen(client, watchlist_id)

    assert response.status_code == 200, response.text
    assert response.json()["market_signals"] == []


def test_multiple_stocks_each_evaluated_independently(client):
    _register(client)
    watchlist_id = _create_watchlist(client)["id"]
    _add_stock(client, watchlist_id, "TATATECH")
    _add_stock(client, watchlist_id, "WIPRO")
    _add_stock(client, watchlist_id, "RELIANCE")
    _use_provider(
        {
            "TATATECH": _quote("TATATECH", price="800.00", day_low="796.10", day_high="830.95"),
            "WIPRO": _quote("WIPRO", price="176.40", day_low="176.40", day_high="180.00"),
            "RELIANCE": _quote("RELIANCE", price="2970.00", day_low="2900.00", day_high="2990.00"),
        }
    )

    response = _seen(client, watchlist_id)

    assert response.status_code == 200, response.text
    symbols = {s["symbol"] for s in response.json()["market_signals"]}
    assert symbols == {"TATATECH", "WIPRO"}
