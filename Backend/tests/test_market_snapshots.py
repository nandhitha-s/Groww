from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.main import app
from app.models.change_event import ChangeEvent
from app.models.market_snapshot import MarketSnapshot
from app.models.user_stock_state import UserStockState
from app.providers.market_data import MarketDataProvider, ProviderUnavailableError
from app.schemas.market_data import HistoricalResponse, HistoryPeriod, QuoteResponse, StockSearchResult
from app.services.market_data import MarketDataService, get_market_data_service

WATCHLISTS_URL = "/api/watchlists"


def _register(client, email="alice@example.com", name="Alice", password="correct-horse-battery"):
    response = client.post(
        "/api/auth/register", json={"name": name, "email": email, "password": password}
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_watchlist(client, name="Technology"):
    return client.post(WATCHLISTS_URL, json={"name": name})


def _add_stock(client, watchlist_id, symbol="NVDA"):
    return client.post(f"{WATCHLISTS_URL}/{watchlist_id}/stocks", json={"symbol": symbol})


def _seen(client, watchlist_id):
    return client.post(f"{WATCHLISTS_URL}/{watchlist_id}/market-state/seen")


def _quote(
    symbol="NVDA",
    price="1300.00",
    previous_close="1290.00",
    volume=1_000_000,
    average_volume=900_000,
    is_delayed=True,
    timestamp=None,
) -> QuoteResponse:
    price_d = Decimal(price)
    prev_d = Decimal(previous_close)
    return QuoteResponse(
        symbol=symbol,
        price=price_d,
        previous_close=prev_d,
        day_high=price_d,
        day_low=prev_d,
        volume=volume,
        average_volume=average_volume,
        change=price_d - prev_d,
        change_percent=Decimal("1.0"),
        timestamp=timestamp or datetime.now(timezone.utc),
        data_source="Yahoo Finance",
        is_delayed=is_delayed,
    )


class _FakeProvider(MarketDataProvider):
    """Maps symbol -> QuoteResponse (or an Exception instance to raise),
    configured per-test. Never touches the network."""

    def __init__(self, quotes: dict[str, object] | None = None):
        self._quotes = quotes or {}

    def search_stocks(self, query: str) -> list[StockSearchResult]:
        return []

    def get_quote(self, symbol: str) -> QuoteResponse:
        result = self._quotes.get(symbol)
        if isinstance(result, Exception):
            raise result
        if result is None:
            raise ProviderUnavailableError(f"no fake quote configured for {symbol}")
        return result

    def get_history(self, symbol: str, period: HistoryPeriod) -> HistoricalResponse:
        raise NotImplementedError


def _use_provider(quotes: dict[str, object]):
    app.dependency_overrides[get_market_data_service] = lambda: MarketDataService(_FakeProvider(quotes))


@pytest.fixture(autouse=True)
def _reset_market_data_override():
    yield
    app.dependency_overrides.pop(get_market_data_service, None)


# ---------------------------------------------------------------------------
# 1. First-time user
# ---------------------------------------------------------------------------


def test_first_time_user_creates_snapshot_and_state_no_change_event(client, db_session):
    user = _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    stock = _add_stock(client, watchlist_id, "NVDA").json()
    _use_provider({"NVDA": _quote(symbol="NVDA", price="1300.00", volume=1_000_000)})

    response = _seen(client, watchlist_id)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["watchlist_id"] == watchlist_id
    assert body["processed"] == 1
    assert body["successful"] == 1
    assert body["failed"] == 0
    assert body["failed_symbols"] == []
    assert body["seen_at"]

    snapshots = db_session.execute(
        select(MarketSnapshot).where(MarketSnapshot.stock_id == stock["id"])
    ).scalars().all()
    assert len(snapshots) == 1
    assert snapshots[0].price == Decimal("1300.00")

    state = db_session.execute(
        select(UserStockState).where(
            UserStockState.user_id == user["id"], UserStockState.stock_id == stock["id"]
        )
    ).scalar_one()
    assert state.last_seen_price == Decimal("1300.00")
    assert state.last_seen_volume == 1_000_000
    assert state.last_seen_at is not None

    change_event_count = db_session.execute(select(func.count()).select_from(ChangeEvent)).scalar_one()
    assert change_event_count == 0


# ---------------------------------------------------------------------------
# 2 & 11. Repeated visits: previous state is superseded, history preserved
# ---------------------------------------------------------------------------


def test_repeated_visit_updates_state_and_preserves_snapshot_history(client, db_session):
    user = _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    stock = _add_stock(client, watchlist_id, "RELIANCE").json()

    _use_provider({"RELIANCE": _quote(symbol="RELIANCE", price="1300.00")})
    assert _seen(client, watchlist_id).status_code == 200

    state_after_first = db_session.execute(
        select(UserStockState).where(
            UserStockState.user_id == user["id"], UserStockState.stock_id == stock["id"]
        )
    ).scalar_one()
    assert state_after_first.last_seen_price == Decimal("1300.00")
    first_seen_at = state_after_first.last_seen_at

    _use_provider({"RELIANCE": _quote(symbol="RELIANCE", price="1350.00")})
    assert _seen(client, watchlist_id).status_code == 200

    # The upsert runs as a raw Core statement (deliberately, to stay atomic
    # under concurrency -- see record_user_stock_seen), which does not
    # refresh the already-loaded `state_after_first` ORM object above.
    # Expire it so this query re-reads the row's real, current DB values
    # instead of returning the stale identity-mapped instance.
    db_session.expire_all()

    # Exactly one state row still -- updated in place, not duplicated.
    states = db_session.execute(
        select(UserStockState).where(
            UserStockState.user_id == user["id"], UserStockState.stock_id == stock["id"]
        )
    ).scalars().all()
    assert len(states) == 1
    assert states[0].last_seen_price == Decimal("1350.00")
    assert states[0].last_seen_at >= first_seen_at

    # Both snapshots survive -- history is never thinned out.
    snapshots = db_session.execute(
        select(MarketSnapshot).where(MarketSnapshot.stock_id == stock["id"]).order_by(MarketSnapshot.timestamp)
    ).scalars().all()
    assert len(snapshots) == 2
    assert [s.price for s in snapshots] == [Decimal("1300.00"), Decimal("1350.00")]


# ---------------------------------------------------------------------------
# 3. Multiple stocks
# ---------------------------------------------------------------------------


def test_multiple_stocks_each_produce_correct_snapshot_and_state(client, db_session):
    user = _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    nvda = _add_stock(client, watchlist_id, "NVDA").json()
    aapl = _add_stock(client, watchlist_id, "AAPL").json()

    _use_provider(
        {
            "NVDA": _quote(symbol="NVDA", price="120.00", volume=500),
            "AAPL": _quote(symbol="AAPL", price="230.00", volume=700),
        }
    )

    response = _seen(client, watchlist_id)
    body = response.json()
    assert body["processed"] == 2
    assert body["successful"] == 2
    assert body["failed"] == 0

    for stock, expected_price, expected_volume in [(nvda, "120.00", 500), (aapl, "230.00", 700)]:
        state = db_session.execute(
            select(UserStockState).where(
                UserStockState.user_id == user["id"], UserStockState.stock_id == stock["id"]
            )
        ).scalar_one()
        assert state.last_seen_price == Decimal(expected_price)
        assert state.last_seen_volume == expected_volume


# ---------------------------------------------------------------------------
# 4 & 9. Partial quote failure: isolated, no fabrication
# ---------------------------------------------------------------------------


def test_partial_quote_failure_isolated_and_not_fabricated(client, db_session):
    user = _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    good = _add_stock(client, watchlist_id, "RELIANCE").json()
    bad = _add_stock(client, watchlist_id, "INFY").json()

    _use_provider(
        {
            "RELIANCE": _quote(symbol="RELIANCE", price="2500.00"),
            "INFY": ProviderUnavailableError("provider down"),
        }
    )

    response = _seen(client, watchlist_id)
    assert response.status_code == 200
    body = response.json()
    assert body["processed"] == 2
    assert body["successful"] == 1
    assert body["failed"] == 1
    assert body["failed_symbols"] == ["INFY"]

    good_snapshots = db_session.execute(
        select(MarketSnapshot).where(MarketSnapshot.stock_id == good["id"])
    ).scalars().all()
    assert len(good_snapshots) == 1

    bad_snapshots = db_session.execute(
        select(MarketSnapshot).where(MarketSnapshot.stock_id == bad["id"])
    ).scalars().all()
    assert bad_snapshots == []

    good_state = db_session.execute(
        select(UserStockState).where(
            UserStockState.user_id == user["id"], UserStockState.stock_id == good["id"]
        )
    ).scalar_one_or_none()
    assert good_state is not None

    bad_state = db_session.execute(
        select(UserStockState).where(
            UserStockState.user_id == user["id"], UserStockState.stock_id == bad["id"]
        )
    ).scalar_one_or_none()
    assert bad_state is None


# ---------------------------------------------------------------------------
# 5. Ownership
# ---------------------------------------------------------------------------


def test_another_user_cannot_record_state_for_the_watchlist(client, client2, db_session):
    _register(client, email="alice@example.com")
    _register(client2, email="bob@example.com")
    watchlist_id = _create_watchlist(client).json()["id"]
    stock = _add_stock(client, watchlist_id, "NVDA").json()
    _use_provider({"NVDA": _quote(symbol="NVDA")})

    response = _seen(client2, watchlist_id)
    assert response.status_code == 404

    snapshot_count = db_session.execute(
        select(func.count()).select_from(MarketSnapshot).where(MarketSnapshot.stock_id == stock["id"])
    ).scalar_one()
    assert snapshot_count == 0


# ---------------------------------------------------------------------------
# 6. Empty watchlist
# ---------------------------------------------------------------------------


def test_empty_watchlist_returns_zero_counts(client):
    _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    _use_provider({})

    response = _seen(client, watchlist_id)
    assert response.status_code == 200
    body = response.json()
    assert body["processed"] == 0
    assert body["successful"] == 0
    assert body["failed"] == 0
    assert body["failed_symbols"] == []


# ---------------------------------------------------------------------------
# 7 & 8. Duplicate prevention across repeated calls
# ---------------------------------------------------------------------------


def test_repeated_calls_never_duplicate_user_stock_state(client, db_session):
    user = _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    stock = _add_stock(client, watchlist_id, "NVDA").json()

    for price in ("100.00", "101.00", "102.00"):
        _use_provider({"NVDA": _quote(symbol="NVDA", price=price)})
        assert _seen(client, watchlist_id).status_code == 200

    states = db_session.execute(
        select(UserStockState).where(
            UserStockState.user_id == user["id"], UserStockState.stock_id == stock["id"]
        )
    ).scalars().all()
    assert len(states) == 1
    assert states[0].last_seen_price == Decimal("102.00")

    snapshots = db_session.execute(
        select(func.count()).select_from(MarketSnapshot).where(MarketSnapshot.stock_id == stock["id"])
    ).scalar_one()
    assert snapshots == 3


# ---------------------------------------------------------------------------
# 12. Timezone-aware timestamps
# ---------------------------------------------------------------------------


def test_timestamps_are_timezone_aware(client, db_session):
    user = _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    stock = _add_stock(client, watchlist_id, "NVDA").json()
    _use_provider({"NVDA": _quote(symbol="NVDA")})

    assert _seen(client, watchlist_id).status_code == 200

    snapshot = db_session.execute(
        select(MarketSnapshot).where(MarketSnapshot.stock_id == stock["id"])
    ).scalar_one()
    assert snapshot.timestamp.tzinfo is not None

    state = db_session.execute(
        select(UserStockState).where(
            UserStockState.user_id == user["id"], UserStockState.stock_id == stock["id"]
        )
    ).scalar_one()
    assert state.last_seen_at.tzinfo is not None


# ---------------------------------------------------------------------------
# 13. Rollback on persistence failure
# ---------------------------------------------------------------------------


def test_persistence_failure_rolls_back_the_whole_batch(client, db_session, monkeypatch):
    _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    stock_a = _add_stock(client, watchlist_id, "AAA").json()
    stock_b = _add_stock(client, watchlist_id, "BBB").json()
    _use_provider({"AAA": _quote(symbol="AAA"), "BBB": _quote(symbol="BBB")})

    import app.services.market_snapshots as market_snapshots_module

    original_record_snapshot = market_snapshots_module.record_snapshot
    call_count = {"n": 0}

    def _boom(db, *, stock_id, quote):
        call_count["n"] += 1
        if call_count["n"] == 2:
            raise RuntimeError("simulated database failure")
        return original_record_snapshot(db, stock_id=stock_id, quote=quote)

    monkeypatch.setattr(market_snapshots_module, "record_snapshot", _boom)

    with pytest.raises(RuntimeError):
        _seen(client, watchlist_id)

    for stock in (stock_a, stock_b):
        remaining = db_session.execute(
            select(func.count()).select_from(MarketSnapshot).where(MarketSnapshot.stock_id == stock["id"])
        ).scalar_one()
        assert remaining == 0, "a failed batch must not leave partial snapshot rows"

        state = db_session.execute(
            select(UserStockState).where(UserStockState.stock_id == stock["id"])
        ).scalar_one_or_none()
        assert state is None, "a failed batch must not leave a partial UserStockState row"


# ---------------------------------------------------------------------------
# 14 & 15. Auth / invalid watchlist
# ---------------------------------------------------------------------------


def test_unauthenticated_request_rejected(client):
    response = _seen(client, "00000000-0000-0000-0000-000000000000")
    assert response.status_code == 401


def test_nonexistent_watchlist_rejected(client):
    _register(client)
    response = _seen(client, "00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404
