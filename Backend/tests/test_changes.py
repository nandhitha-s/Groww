from datetime import datetime, timezone
from decimal import Decimal

import pytest

from app.main import app
from app.providers.market_data import MarketDataProvider
from app.schemas.market_data import HistoricalResponse, HistoryPeriod, QuoteResponse, StockSearchResult
from app.services.market_data import MarketDataService, get_market_data_service

WATCHLISTS_URL = "/api/watchlists"
CHANGES_URL = "/api/changes"


def _register(client, email="alice@example.com", name="Alice", password="correct-horse-battery"):
    response = client.post(
        "/api/auth/register", json={"name": name, "email": email, "password": password}
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_watchlist(client, name="Technology"):
    response = client.post(WATCHLISTS_URL, json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


def _add_stock(client, watchlist_id, symbol):
    response = client.post(f"{WATCHLISTS_URL}/{watchlist_id}/stocks", json={"symbol": symbol})
    assert response.status_code == 201, response.text
    return response.json()


def _seen(client, watchlist_id):
    response = client.post(f"{WATCHLISTS_URL}/{watchlist_id}/market-state/seen")
    assert response.status_code == 200, response.text
    return response.json()


def _quote(symbol, price, volume=1_000_000, average_volume=900_000) -> QuoteResponse:
    price_d = Decimal(price)
    return QuoteResponse(
        symbol=symbol,
        price=price_d,
        previous_close=price_d,
        day_high=price_d,
        day_low=price_d,
        volume=volume,
        average_volume=average_volume,
        change=Decimal("0"),
        change_percent=Decimal("0"),
        timestamp=datetime.now(timezone.utc),
        data_source="Yahoo Finance",
        is_delayed=True,
    )


class _FakeProvider(MarketDataProvider):
    """Maps symbol -> QuoteResponse, swappable per-call so a test can
    control exactly what the "next" quote looks like. Never touches the
    network -- every generated ChangeEvent here is real (produced by the
    actual detection pipeline), only the market data feeding it is fake."""

    def __init__(self, quotes: dict[str, QuoteResponse] | None = None):
        self._quotes = quotes or {}

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


def _seed_events(client):
    """Produces two real, persisted ChangeEvents for `client`'s user via the
    actual Phase 6A pipeline: a HIGH PRICE_CHANGE on NVDA and a MEDIUM
    VOLUME_SPIKE on AAPL. Returns {"watchlist_id", "nvda_stock_id",
    "aapl_stock_id"}."""
    watchlist_id = _create_watchlist(client)["id"]
    nvda = _add_stock(client, watchlist_id, "NVDA")
    aapl = _add_stock(client, watchlist_id, "AAPL")

    _use_provider({
        "NVDA": _quote("NVDA", "1000.00", volume=1_000_000, average_volume=1_000_000),
        "AAPL": _quote("AAPL", "200.00", volume=1_000_000, average_volume=1_000_000),
    })
    _seen(client, watchlist_id)  # baseline only, no events yet

    # NVDA +25% price -> HIGH PRICE_CHANGE. AAPL volume 2.5x average -> MEDIUM VOLUME_SPIKE.
    _use_provider({
        "NVDA": _quote("NVDA", "1250.00", volume=1_000_000, average_volume=1_000_000),
        "AAPL": _quote("AAPL", "200.00", volume=2_500_000, average_volume=1_000_000),
    })
    result = _seen(client, watchlist_id)
    assert result["detected"] == 2, result

    return {"watchlist_id": watchlist_id, "nvda_stock_id": nvda["id"], "aapl_stock_id": aapl["id"]}


# ---------------------------------------------------------------------------
# 1. Authenticated user gets own events
# ---------------------------------------------------------------------------


def test_authenticated_user_gets_own_events(client):
    _register(client)
    _seed_events(client)

    response = client.get(CHANGES_URL)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["count"] == 2
    symbols = {item["symbol"] for item in body["items"]}
    assert symbols == {"NVDA", "AAPL"}


def test_requires_authentication(client):
    response = client.get(CHANGES_URL)
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# 2. Another user's events are never returned
# ---------------------------------------------------------------------------


def test_never_returns_another_users_events(client, client2):
    _register(client, email="alice@example.com")
    _seed_events(client)

    _register(client2, email="bob@example.com", name="Bob")
    bob_watchlist_id = _create_watchlist(client2, name="Bob's List")["id"]
    _add_stock(client2, bob_watchlist_id, "TSLA")
    _use_provider({"TSLA": _quote("TSLA", "500.00")})
    _seen(client2, bob_watchlist_id)  # Bob's own baseline -- no event, and must not leak to Alice either way.

    response = client2.get(CHANGES_URL)

    assert response.status_code == 200, response.text
    assert response.json()["items"] == []


# ---------------------------------------------------------------------------
# 3. Ordered newest first
# ---------------------------------------------------------------------------


def test_ordered_newest_first(client):
    _register(client)
    _seed_events(client)

    body = client.get(CHANGES_URL).json()

    detected_ats = [item["detected_at"] for item in body["items"]]
    assert detected_ats == sorted(detected_ats, reverse=True)


# ---------------------------------------------------------------------------
# 4. Filters
# ---------------------------------------------------------------------------


def test_filter_by_severity(client):
    _register(client)
    _seed_events(client)

    body = client.get(CHANGES_URL, params={"severity": "HIGH"}).json()

    assert body["count"] == 1
    assert body["items"][0]["symbol"] == "NVDA"
    assert body["items"][0]["severity"] == "HIGH"


def test_filter_by_type(client):
    _register(client)
    _seed_events(client)

    body = client.get(CHANGES_URL, params={"type": "VOLUME_SPIKE"}).json()

    assert body["count"] == 1
    assert body["items"][0]["symbol"] == "AAPL"
    assert body["items"][0]["type"] == "VOLUME_SPIKE"


def test_filter_by_stock_id(client):
    _register(client)
    seeded = _seed_events(client)

    body = client.get(CHANGES_URL, params={"stock_id": seeded["nvda_stock_id"]}).json()

    assert body["count"] == 1
    assert body["items"][0]["symbol"] == "NVDA"


# ---------------------------------------------------------------------------
# 5. Limit
# ---------------------------------------------------------------------------


def test_limit(client):
    _register(client)
    _seed_events(client)

    body = client.get(CHANGES_URL, params={"limit": 1}).json()

    assert body["limit"] == 1
    assert body["count"] == 1
    assert len(body["items"]) == 1


# ---------------------------------------------------------------------------
# 6. Acknowledgement
# ---------------------------------------------------------------------------


def test_acknowledge_marks_event_and_is_idempotent(client):
    _register(client)
    _seed_events(client)
    change_id = client.get(CHANGES_URL, params={"severity": "HIGH"}).json()["items"][0]["id"]

    response = client.post(f"{CHANGES_URL}/{change_id}/acknowledge")
    assert response.status_code == 200, response.text
    first_ack = response.json()["acknowledged_at"]
    assert first_ack is not None

    # Acknowledging again must not move the timestamp forward.
    response2 = client.post(f"{CHANGES_URL}/{change_id}/acknowledge")
    assert response2.json()["acknowledged_at"] == first_ack

    listed = client.get(CHANGES_URL, params={"severity": "HIGH"}).json()["items"][0]
    assert listed["acknowledged_at"] == first_ack


def test_acknowledge_another_users_event_is_not_found(client, client2):
    _register(client, email="alice@example.com")
    seeded = _seed_events(client)
    change_id = client.get(CHANGES_URL, params={"stock_id": seeded["nvda_stock_id"]}).json()["items"][0]["id"]

    _register(client2, email="bob@example.com", name="Bob")

    response = client2.post(f"{CHANGES_URL}/{change_id}/acknowledge")
    assert response.status_code == 404


def test_acknowledge_unknown_id_is_not_found(client):
    _register(client)
    response = client.post(f"{CHANGES_URL}/00000000-0000-0000-0000-000000000000/acknowledge")
    assert response.status_code == 404
