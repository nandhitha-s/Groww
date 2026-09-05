"""Phase 6A: the deterministic Meaningful Change Engine.

Split into two parts:
- Pure unit tests against `app.services.change_engine` directly -- no HTTP,
  no DB, exercising the actual comparison/severity/formatting logic.
- Integration tests through the real `POST /api/watchlists/{id}/market-state/seen`
  endpoint (the same one Phase 5A built), following the exact fixture
  conventions established in tests/test_market_snapshots.py.

Test-only stock symbols here are deliberately implausible as real tickers
(ZZALPHA, ZZBETA, ...) to avoid ever colliding with a real Stock row from
manual/browser verification, which has bitten this project's test isolation
before (Stock.symbol is globally unique, and the rollback-only test session
doesn't roll back rows that were already really committed outside a test).
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.enums import ChangeEventSeverity, ChangeEventType
from app.main import app
from app.models.change_event import ChangeEvent
from app.models.market_snapshot import MarketSnapshot
from app.models.user_preference import UserPreference
from app.models.user_stock_state import UserStockState
from app.providers.market_data import MarketDataProvider, ProviderUnavailableError
from app.schemas.market_data import HistoricalResponse, HistoryPeriod, QuoteResponse, StockSearchResult
from app.services import change_engine
from app.services.market_data import MarketDataService, get_market_data_service

WATCHLISTS_URL = "/api/watchlists"


# ---------------------------------------------------------------------------
# Pure unit tests: app.services.change_engine, no HTTP/DB involved except
# resolve_thresholds (which needs a session only to read UserPreference).
# ---------------------------------------------------------------------------


def test_price_move_above_threshold_is_meaningful():
    change = change_engine.evaluate_price_move(
        stock_id="11111111-1111-1111-1111-111111111111",
        symbol="ZZALPHA",
        previous_price=Decimal("1000"),
        current_price=Decimal("1040"),
        threshold=Decimal("3"),
    )
    assert change is not None
    assert change.type == ChangeEventType.PRICE_CHANGE
    assert change.old_value == Decimal("1000")
    assert change.new_value == Decimal("1040")
    assert "ZZALPHA" in change.title
    assert "4.0%" in change.title


def test_price_move_below_threshold_is_not_meaningful():
    change = change_engine.evaluate_price_move(
        stock_id="11111111-1111-1111-1111-111111111111",
        symbol="ZZALPHA",
        previous_price=Decimal("1000"),
        current_price=Decimal("1015"),
        threshold=Decimal("3"),
    )
    assert change is None


def test_price_move_downward_beyond_threshold_is_meaningful():
    change = change_engine.evaluate_price_move(
        stock_id="11111111-1111-1111-1111-111111111111",
        symbol="ZZALPHA",
        previous_price=Decimal("1000"),
        current_price=Decimal("959"),
        threshold=Decimal("3"),
    )
    assert change is not None
    assert "fell" in change.title
    assert "4.1%" in change.title
    assert change.old_value == Decimal("1000")
    assert change.new_value == Decimal("959")


def test_price_move_exactly_at_threshold_is_meaningful():
    # previous=1000, current=1030 -> exactly +3.0%, threshold=3
    change = change_engine.evaluate_price_move(
        stock_id="11111111-1111-1111-1111-111111111111",
        symbol="ZZALPHA",
        previous_price=Decimal("1000"),
        current_price=Decimal("1030"),
        threshold=Decimal("3"),
    )
    assert change is not None
    assert change.severity == ChangeEventSeverity.MEDIUM


def test_price_move_just_under_threshold_is_not_meaningful():
    # previous=1000, current=1029.99 -> +2.999%, threshold=3
    change = change_engine.evaluate_price_move(
        stock_id="11111111-1111-1111-1111-111111111111",
        symbol="ZZALPHA",
        previous_price=Decimal("1000"),
        current_price=Decimal("1029.99"),
        threshold=Decimal("3"),
    )
    assert change is None


def test_price_move_moderate_magnitude_gets_medium_severity():
    # magnitude 4%, threshold 3 -> in [3, 6) -> MEDIUM
    change = change_engine.evaluate_price_move(
        stock_id="11111111-1111-1111-1111-111111111111",
        symbol="ZZALPHA",
        previous_price=Decimal("1000"),
        current_price=Decimal("1040"),
        threshold=Decimal("3"),
    )
    assert change.severity == ChangeEventSeverity.MEDIUM


def test_price_move_high_magnitude_gets_high_severity():
    # magnitude 10%, threshold 3 -> >= 6 -> HIGH
    change = change_engine.evaluate_price_move(
        stock_id="11111111-1111-1111-1111-111111111111",
        symbol="ZZALPHA",
        previous_price=Decimal("1000"),
        current_price=Decimal("1100"),
        threshold=Decimal("3"),
    )
    assert change.severity == ChangeEventSeverity.HIGH


def test_price_move_zero_baseline_does_not_crash_and_creates_no_event():
    change = change_engine.evaluate_price_move(
        stock_id="11111111-1111-1111-1111-111111111111",
        symbol="ZZALPHA",
        previous_price=Decimal("0"),
        current_price=Decimal("10"),
        threshold=Decimal("3"),
    )
    assert change is None


def test_volume_spike_above_threshold_is_meaningful():
    change = change_engine.evaluate_volume_spike(
        stock_id="11111111-1111-1111-1111-111111111111",
        symbol="ZZALPHA",
        current_volume=1_700_000,
        average_volume=1_000_000,
        threshold=Decimal("50"),
    )
    assert change is not None
    assert change.type == ChangeEventType.VOLUME_SPIKE
    assert change.severity == ChangeEventSeverity.MEDIUM  # 70% excess, threshold 50 -> [50,100)
    assert change.old_value == Decimal("1000000")
    assert change.new_value == Decimal("1700000")
    assert "72%" not in change.title  # sanity: not fabricated, this case is 70%
    assert "70%" in change.title


def test_volume_spike_below_threshold_is_not_meaningful():
    change = change_engine.evaluate_volume_spike(
        stock_id="11111111-1111-1111-1111-111111111111",
        symbol="ZZALPHA",
        current_volume=1_200_000,
        average_volume=1_000_000,
        threshold=Decimal("50"),
    )
    assert change is None


def test_volume_spike_missing_average_volume_creates_no_event():
    change = change_engine.evaluate_volume_spike(
        stock_id="11111111-1111-1111-1111-111111111111",
        symbol="ZZALPHA",
        current_volume=1_700_000,
        average_volume=None,
        threshold=Decimal("50"),
    )
    assert change is None


def test_volume_spike_zero_average_volume_creates_no_event():
    change = change_engine.evaluate_volume_spike(
        stock_id="11111111-1111-1111-1111-111111111111",
        symbol="ZZALPHA",
        current_volume=1_700_000,
        average_volume=0,
        threshold=Decimal("50"),
    )
    assert change is None


def test_volume_spike_missing_current_volume_creates_no_event():
    change = change_engine.evaluate_volume_spike(
        stock_id="11111111-1111-1111-1111-111111111111",
        symbol="ZZALPHA",
        current_volume=None,
        average_volume=1_000_000,
        threshold=Decimal("50"),
    )
    assert change is None


def test_volume_spike_high_excess_gets_high_severity():
    # excess 120%, threshold 50 -> >= 100 -> HIGH
    change = change_engine.evaluate_volume_spike(
        stock_id="11111111-1111-1111-1111-111111111111",
        symbol="ZZALPHA",
        current_volume=2_200_000,
        average_volume=1_000_000,
        threshold=Decimal("50"),
    )
    assert change.severity == ChangeEventSeverity.HIGH


def test_volume_spike_description_uses_actual_formatted_values():
    change = change_engine.evaluate_volume_spike(
        stock_id="11111111-1111-1111-1111-111111111111",
        symbol="ZZALPHA",
        current_volume=17_200_000,
        average_volume=10_000_000,
        threshold=Decimal("50"),
    )
    assert change is not None
    assert "10.0M" in change.description
    assert "17.2M" in change.description


def test_detect_changes_returns_nothing_without_previous_state():
    quote = _quote(price="2900.00")
    changes = change_engine.detect_changes(
        stock_id="11111111-1111-1111-1111-111111111111",
        symbol="ZZALPHA",
        previous_state=None,
        quote=quote,
        thresholds=change_engine.ChangeThresholds(
            price_change_threshold=Decimal("3"), volume_spike_threshold=Decimal("50")
        ),
    )
    assert changes == []


def test_detect_changes_returns_nothing_when_previous_price_is_none():
    state = UserStockState(last_seen_price=None, last_seen_volume=None)
    changes = change_engine.detect_changes(
        stock_id="11111111-1111-1111-1111-111111111111",
        symbol="ZZALPHA",
        previous_state=state,
        quote=_quote(price="2900.00"),
        thresholds=change_engine.ChangeThresholds(
            price_change_threshold=Decimal("3"), volume_spike_threshold=Decimal("50")
        ),
    )
    assert changes == []


def test_detect_changes_returns_both_signals_when_both_fire():
    state = UserStockState(last_seen_price=Decimal("1000"), last_seen_volume=1_000_000)
    quote = _quote(price="1100", volume=2_000_000, average_volume=1_000_000)
    changes = change_engine.detect_changes(
        stock_id="11111111-1111-1111-1111-111111111111",
        symbol="ZZALPHA",
        previous_state=state,
        quote=quote,
        thresholds=change_engine.ChangeThresholds(
            price_change_threshold=Decimal("3"), volume_spike_threshold=Decimal("50")
        ),
    )
    types = {c.type for c in changes}
    assert types == {ChangeEventType.PRICE_CHANGE, ChangeEventType.VOLUME_SPIKE}


def test_resolve_thresholds_uses_application_default_without_a_preference_row(db_session):

    thresholds = change_engine.resolve_thresholds(db_session, user_id=uuid.uuid4())
    assert thresholds.price_change_threshold == change_engine.DEFAULT_PRICE_CHANGE_THRESHOLD
    assert thresholds.volume_spike_threshold == change_engine.DEFAULT_VOLUME_SPIKE_THRESHOLD


def test_resolve_thresholds_uses_the_users_own_preference_row(client, db_session):
    user = _register(client)

    preference = UserPreference(
        user_id=uuid.UUID(user["id"]),
        price_change_threshold=Decimal("2.50"),
        volume_spike_threshold=Decimal("30.00"),
    )
    db_session.add(preference)
    db_session.commit()

    thresholds = change_engine.resolve_thresholds(db_session, user_id=uuid.UUID(user["id"]))
    assert thresholds.price_change_threshold == Decimal("2.50")
    assert thresholds.volume_spike_threshold == Decimal("30.00")


# ---------------------------------------------------------------------------
# Shared fixtures/helpers for the integration tests below (mirrors
# tests/test_market_snapshots.py's own local conventions).
# ---------------------------------------------------------------------------


def _register(client, email="alice-6a@example.com", name="Alice", password="correct-horse-battery"):
    response = client.post(
        "/api/auth/register", json={"name": name, "email": email, "password": password}
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_watchlist(client, name="Change Engine Test"):
    return client.post(WATCHLISTS_URL, json={"name": name})


def _add_stock(client, watchlist_id, symbol="ZZALPHA"):
    return client.post(f"{WATCHLISTS_URL}/{watchlist_id}/stocks", json={"symbol": symbol})


def _seen(client, watchlist_id):
    return client.post(f"{WATCHLISTS_URL}/{watchlist_id}/market-state/seen")


def _quote(
    symbol="ZZALPHA",
    price="1000.00",
    previous_close="990.00",
    volume=1_000_000,
    average_volume=1_000_000,
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


def _set_preference(db_session, user_id, *, price_change_threshold="3.00", volume_spike_threshold="50.00"):

    preference = UserPreference(
        user_id=uuid.UUID(user_id) if isinstance(user_id, str) else user_id,
        price_change_threshold=Decimal(price_change_threshold),
        volume_spike_threshold=Decimal(volume_spike_threshold),
    )
    db_session.add(preference)
    db_session.commit()


@pytest.fixture(autouse=True)
def _reset_market_data_override():
    yield
    app.dependency_overrides.pop(get_market_data_service, None)


# ---------------------------------------------------------------------------
# 1. First observation creates no ChangeEvent.
# ---------------------------------------------------------------------------


def test_first_observation_creates_no_change_event(client, db_session):
    user = _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    stock = _add_stock(client, watchlist_id, "ZZALPHA").json()
    _use_provider({"ZZALPHA": _quote(price="2900.00")})

    response = _seen(client, watchlist_id)
    assert response.status_code == 200
    body = response.json()
    assert body["detected"] == 0
    assert body["changes"] == []

    events = db_session.execute(
        select(ChangeEvent).where(ChangeEvent.user_id == user["id"], ChangeEvent.stock_id == stock["id"])
    ).scalars().all()
    assert events == []


# ---------------------------------------------------------------------------
# 2/3/6. Price increase above threshold -> PRICE_CHANGE, correct severity.
# ---------------------------------------------------------------------------


def test_price_increase_above_threshold_creates_price_change_event(client, db_session):
    user = _register(client)
    _set_preference(db_session, user["id"], price_change_threshold="3.00")
    watchlist_id = _create_watchlist(client).json()["id"]
    stock = _add_stock(client, watchlist_id, "ZZALPHA").json()

    _use_provider({"ZZALPHA": _quote(price="1000.00")})
    assert _seen(client, watchlist_id).status_code == 200  # baseline only

    _use_provider({"ZZALPHA": _quote(price="1040.00")})
    response = _seen(client, watchlist_id)
    assert response.status_code == 200
    body = response.json()
    assert body["detected"] == 1
    change = body["changes"][0]
    assert change["type"] == "PRICE_CHANGE"
    assert change["severity"] == "MEDIUM"
    assert change["symbol"] == "ZZALPHA"
    assert Decimal(change["old_value"]) == Decimal("1000.00")
    assert Decimal(change["new_value"]) == Decimal("1040.00")
    assert "4.0%" in change["title"]
    assert "ZZALPHA" in change["description"]

    events = db_session.execute(
        select(ChangeEvent).where(ChangeEvent.user_id == user["id"], ChangeEvent.stock_id == stock["id"])
    ).scalars().all()
    assert len(events) == 1
    assert events[0].type == ChangeEventType.PRICE_CHANGE
    assert events[0].severity == ChangeEventSeverity.MEDIUM
    assert str(events[0].watchlist_id) == watchlist_id


# ---------------------------------------------------------------------------
# 3 (down)/7. Price decrease beyond threshold -> PRICE_CHANGE.
# ---------------------------------------------------------------------------


def test_price_decrease_beyond_threshold_creates_price_change_event(client, db_session):
    user = _register(client)
    _set_preference(db_session, user["id"], price_change_threshold="3.00")
    watchlist_id = _create_watchlist(client).json()["id"]
    _add_stock(client, watchlist_id, "ZZALPHA")

    _use_provider({"ZZALPHA": _quote(price="1000.00")})
    assert _seen(client, watchlist_id).status_code == 200

    _use_provider({"ZZALPHA": _quote(price="950.00")})
    response = _seen(client, watchlist_id)
    body = response.json()
    assert body["detected"] == 1
    change = body["changes"][0]
    assert change["type"] == "PRICE_CHANGE"
    assert "fell" in change["title"]
    assert Decimal(change["old_value"]) == Decimal("1000.00")
    assert Decimal(change["new_value"]) == Decimal("950.00")


# ---------------------------------------------------------------------------
# 4. Price movement below threshold creates no event.
# ---------------------------------------------------------------------------


def test_price_move_below_threshold_creates_no_event_via_endpoint(client, db_session):
    user = _register(client)
    _set_preference(db_session, user["id"], price_change_threshold="3.00")
    watchlist_id = _create_watchlist(client).json()["id"]
    _add_stock(client, watchlist_id, "ZZALPHA")

    _use_provider({"ZZALPHA": _quote(price="1000.00")})
    assert _seen(client, watchlist_id).status_code == 200

    _use_provider({"ZZALPHA": _quote(price="1015.00")})
    response = _seen(client, watchlist_id)
    body = response.json()
    assert body["detected"] == 0
    assert body["changes"] == []


# ---------------------------------------------------------------------------
# 7. High price movement receives HIGH severity (via endpoint).
# ---------------------------------------------------------------------------


def test_high_price_movement_gets_high_severity_via_endpoint(client, db_session):
    user = _register(client)
    _set_preference(db_session, user["id"], price_change_threshold="3.00")
    watchlist_id = _create_watchlist(client).json()["id"]
    _add_stock(client, watchlist_id, "ZZALPHA")

    _use_provider({"ZZALPHA": _quote(price="1000.00")})
    assert _seen(client, watchlist_id).status_code == 200

    _use_provider({"ZZALPHA": _quote(price="1100.00")})  # +10%, >= 2x threshold
    body = _seen(client, watchlist_id).json()
    assert body["changes"][0]["severity"] == "HIGH"


# ---------------------------------------------------------------------------
# 8/9/10/11. Volume spike rules via endpoint.
# ---------------------------------------------------------------------------


def test_volume_spike_above_threshold_creates_event_via_endpoint(client, db_session):
    user = _register(client)
    _set_preference(db_session, user["id"], volume_spike_threshold="50.00")
    watchlist_id = _create_watchlist(client).json()["id"]
    _add_stock(client, watchlist_id, "ZZALPHA")

    _use_provider({"ZZALPHA": _quote(price="1000.00", volume=1_000_000, average_volume=1_000_000)})
    assert _seen(client, watchlist_id).status_code == 200  # baseline

    _use_provider({"ZZALPHA": _quote(price="1000.00", volume=1_700_000, average_volume=1_000_000)})
    body = _seen(client, watchlist_id).json()
    assert body["detected"] == 1
    change = body["changes"][0]
    assert change["type"] == "VOLUME_SPIKE"
    assert Decimal(change["old_value"]) == Decimal("1000000")
    assert Decimal(change["new_value"]) == Decimal("1700000")


def test_volume_below_threshold_creates_no_event_via_endpoint(client, db_session):
    user = _register(client)
    _set_preference(db_session, user["id"], volume_spike_threshold="50.00")
    watchlist_id = _create_watchlist(client).json()["id"]
    _add_stock(client, watchlist_id, "ZZALPHA")

    _use_provider({"ZZALPHA": _quote(price="1000.00", volume=1_000_000, average_volume=1_000_000)})
    assert _seen(client, watchlist_id).status_code == 200

    _use_provider({"ZZALPHA": _quote(price="1000.00", volume=1_200_000, average_volume=1_000_000)})
    body = _seen(client, watchlist_id).json()
    assert body["detected"] == 0


def test_missing_average_volume_creates_no_volume_event_via_endpoint(client, db_session):
    user = _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    _add_stock(client, watchlist_id, "ZZALPHA")

    _use_provider({"ZZALPHA": _quote(price="1000.00", volume=1_000_000, average_volume=1_000_000)})
    assert _seen(client, watchlist_id).status_code == 200

    _use_provider({"ZZALPHA": _quote(price="1000.00", volume=1_700_000, average_volume=None)})
    body = _seen(client, watchlist_id).json()
    assert body["detected"] == 0


def test_zero_average_volume_creates_no_volume_event_via_endpoint(client, db_session):
    user = _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    _add_stock(client, watchlist_id, "ZZALPHA")

    _use_provider({"ZZALPHA": _quote(price="1000.00", volume=1_000_000, average_volume=1_000_000)})
    assert _seen(client, watchlist_id).status_code == 200

    _use_provider({"ZZALPHA": _quote(price="1000.00", volume=1_700_000, average_volume=0)})
    body = _seen(client, watchlist_id).json()
    assert body["detected"] == 0


# ---------------------------------------------------------------------------
# 12. Missing previous user state creates no event (first-time, distinct
# stock so there is genuinely no baseline at all).
# ---------------------------------------------------------------------------


def test_missing_previous_state_creates_no_event_even_with_spike_shaped_quote(client, db_session):
    user = _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    stock = _add_stock(client, watchlist_id, "ZZDELTA").json()

    # A quote that WOULD be a huge spike/move if there were a baseline --
    # but there is none, so Step 8 says no event at all.
    _use_provider({"ZZDELTA": _quote(symbol="ZZDELTA", price="5000.00", volume=50_000_000, average_volume=1_000_000)})
    body = _seen(client, watchlist_id).json()
    assert body["detected"] == 0

    events = db_session.execute(
        select(ChangeEvent).where(ChangeEvent.user_id == user["id"], ChangeEvent.stock_id == stock["id"])
    ).scalars().all()
    assert events == []


# ---------------------------------------------------------------------------
# 13/14/24/25. Event content: correct old/new values, real description,
# timezone-aware detected_at.
# ---------------------------------------------------------------------------


def test_event_content_matches_actual_values_and_is_timezone_aware(client, db_session):
    user = _register(client)
    _set_preference(db_session, user["id"], price_change_threshold="3.00")
    watchlist_id = _create_watchlist(client).json()["id"]
    stock = _add_stock(client, watchlist_id, "ZZALPHA").json()

    _use_provider({"ZZALPHA": _quote(price="2850.00")})
    assert _seen(client, watchlist_id).status_code == 200

    _use_provider({"ZZALPHA": _quote(price="2970.00")})
    body = _seen(client, watchlist_id).json()
    change = body["changes"][0]
    assert Decimal(change["old_value"]) == Decimal("2850.00")
    assert Decimal(change["new_value"]) == Decimal("2970.00")
    assert "2,850.00" in change["description"]
    assert "2,970.00" in change["description"]

    event = db_session.execute(
        select(ChangeEvent).where(ChangeEvent.user_id == user["id"], ChangeEvent.stock_id == stock["id"])
    ).scalar_one()
    assert event.detected_at.tzinfo is not None
    assert Decimal(event.old_value) == Decimal("2850.00")
    assert Decimal(event.new_value) == Decimal("2970.00")


# ---------------------------------------------------------------------------
# 15. Failed quote creates no ChangeEvent.
# ---------------------------------------------------------------------------


def test_failed_quote_creates_no_change_event(client, db_session):
    user = _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    stock = _add_stock(client, watchlist_id, "ZZALPHA").json()

    _use_provider({"ZZALPHA": _quote(price="1000.00")})
    assert _seen(client, watchlist_id).status_code == 200

    _use_provider({"ZZALPHA": ProviderUnavailableError("provider down")})
    body = _seen(client, watchlist_id).json()
    assert body["failed"] == 1
    assert body["detected"] == 0

    events = db_session.execute(
        select(ChangeEvent).where(ChangeEvent.user_id == user["id"], ChangeEvent.stock_id == stock["id"])
    ).scalars().all()
    assert events == []


# ---------------------------------------------------------------------------
# 16/17. Multiple stocks evaluated independently; one failure doesn't
# prevent another's event.
# ---------------------------------------------------------------------------


def test_multiple_stocks_evaluated_independently(client, db_session):
    user = _register(client)
    _set_preference(db_session, user["id"], price_change_threshold="3.00")
    watchlist_id = _create_watchlist(client).json()["id"]
    moving = _add_stock(client, watchlist_id, "ZZALPHA").json()
    flat = _add_stock(client, watchlist_id, "ZZBETA").json()
    failing = _add_stock(client, watchlist_id, "ZZGAMMA").json()

    _use_provider(
        {
            "ZZALPHA": _quote(symbol="ZZALPHA", price="1000.00"),
            "ZZBETA": _quote(symbol="ZZBETA", price="500.00"),
            "ZZGAMMA": _quote(symbol="ZZGAMMA", price="200.00"),
        }
    )
    assert _seen(client, watchlist_id).status_code == 200  # establish baselines

    _use_provider(
        {
            "ZZALPHA": _quote(symbol="ZZALPHA", price="1100.00"),  # +10% -> event
            "ZZBETA": _quote(symbol="ZZBETA", price="505.00"),  # +1% -> no event
            "ZZGAMMA": ProviderUnavailableError("down"),  # fails -> no event, no crash
        }
    )
    body = _seen(client, watchlist_id).json()
    assert body["failed"] == 1
    assert body["detected"] == 1
    assert body["changes"][0]["symbol"] == "ZZALPHA"

    for stock_id, expected_count in [(moving["id"], 1), (flat["id"], 0), (failing["id"], 0)]:
        count = db_session.execute(
            select(func.count()).select_from(ChangeEvent).where(ChangeEvent.stock_id == stock_id)
        ).scalar_one()
        assert count == expected_count


# ---------------------------------------------------------------------------
# 18. Another user cannot detect changes for/see events from someone else's
# watchlist.
# ---------------------------------------------------------------------------


def test_another_user_cannot_detect_changes_for_the_watchlist(client, client2, db_session):
    alice = _register(client, email="alice-change@example.com")
    _register(client2, email="bob-change@example.com")
    watchlist_id = _create_watchlist(client).json()["id"]
    stock = _add_stock(client, watchlist_id, "ZZALPHA").json()

    _use_provider({"ZZALPHA": _quote(price="1000.00")})
    assert _seen(client, watchlist_id).status_code == 200

    _use_provider({"ZZALPHA": _quote(price="1100.00")})
    response = client2.post(f"{WATCHLISTS_URL}/{watchlist_id}/market-state/seen")
    assert response.status_code == 404

    # No event was created by bob's rejected attempt.
    events = db_session.execute(
        select(ChangeEvent).where(ChangeEvent.user_id == alice["id"], ChangeEvent.stock_id == stock["id"])
    ).scalars().all()
    assert events == []


# ---------------------------------------------------------------------------
# 19. Unauthenticated request rejected.
# ---------------------------------------------------------------------------


def test_unauthenticated_request_rejected(client):
    response = _seen(client, "00000000-0000-0000-0000-000000000000")
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# 20. Repeated evaluation does not create inappropriate duplicate events.
# ---------------------------------------------------------------------------


def test_repeated_evaluation_of_the_same_price_does_not_duplicate_events(client, db_session):
    user = _register(client)
    _set_preference(db_session, user["id"], price_change_threshold="3.00")
    watchlist_id = _create_watchlist(client).json()["id"]
    stock = _add_stock(client, watchlist_id, "ZZALPHA").json()

    _use_provider({"ZZALPHA": _quote(price="1000.00")})
    assert _seen(client, watchlist_id).status_code == 200  # baseline, no event

    _use_provider({"ZZALPHA": _quote(price="1100.00")})
    first = _seen(client, watchlist_id).json()
    assert first["detected"] == 1  # the real +10% move

    # Calling "seen" again immediately with the SAME price: the baseline was
    # already advanced to 1100 by the previous call, so comparing 1100 vs
    # 1100 is a 0% change -- naturally no new event, without any special
    # duplicate-detection code (see change_engine.py / market_snapshots.py
    # docstrings for why this is the deduplication strategy).
    second = _seen(client, watchlist_id).json()
    assert second["detected"] == 0

    events = db_session.execute(
        select(ChangeEvent).where(ChangeEvent.user_id == user["id"], ChangeEvent.stock_id == stock["id"])
    ).scalars().all()
    assert len(events) == 1


# ---------------------------------------------------------------------------
# 21. Existing ChangeEvents are not silently overwritten -- multiple real,
# distinct moves over time all persist.
# ---------------------------------------------------------------------------


def test_multiple_distinct_moves_over_time_all_persist(client, db_session):
    user = _register(client)
    _set_preference(db_session, user["id"], price_change_threshold="3.00")
    watchlist_id = _create_watchlist(client).json()["id"]
    stock = _add_stock(client, watchlist_id, "ZZALPHA").json()

    for price in ("1000.00", "1100.00", "1210.00"):  # baseline, then two +10% moves
        _use_provider({"ZZALPHA": _quote(price=price)})
        assert _seen(client, watchlist_id).status_code == 200

    events = db_session.execute(
        select(ChangeEvent)
        .where(ChangeEvent.user_id == user["id"], ChangeEvent.stock_id == stock["id"])
        .order_by(ChangeEvent.detected_at)
    ).scalars().all()
    assert len(events) == 2
    assert [Decimal(e.old_value) for e in events] == [Decimal("1000.00"), Decimal("1100.00")]
    assert [Decimal(e.new_value) for e in events] == [Decimal("1100.00"), Decimal("1210.00")]


# ---------------------------------------------------------------------------
# 22. UserStockState is updated only after comparison (i.e. the comparison
# genuinely used the OLD baseline, not one already overwritten to match).
# ---------------------------------------------------------------------------


def test_comparison_uses_the_baseline_from_before_this_observation(client, db_session):
    user = _register(client)
    _set_preference(db_session, user["id"], price_change_threshold="3.00")
    watchlist_id = _create_watchlist(client).json()["id"]
    stock = _add_stock(client, watchlist_id, "ZZALPHA").json()

    _use_provider({"ZZALPHA": _quote(price="1000.00")})
    assert _seen(client, watchlist_id).status_code == 200

    _use_provider({"ZZALPHA": _quote(price="1040.00")})
    body = _seen(client, watchlist_id).json()
    # If the state had been overwritten BEFORE comparison, this would
    # incorrectly compare 1040 vs 1040 (0%) instead of 1000 vs 1040 (+4%).
    assert body["detected"] == 1
    assert Decimal(body["changes"][0]["old_value"]) == Decimal("1000.00")

    state = db_session.execute(
        select(UserStockState).where(
            UserStockState.user_id == user["id"], UserStockState.stock_id == stock["id"]
        )
    ).scalar_one()
    assert state.last_seen_price == Decimal("1040.00")  # now updated to the new observation


# ---------------------------------------------------------------------------
# 23. Persistence failure rolls back ChangeEvent + snapshot/state writes.
# ---------------------------------------------------------------------------


def test_persistence_failure_rolls_back_change_events_too(client, db_session, monkeypatch):
    user = _register(client)
    _set_preference(db_session, user["id"], price_change_threshold="3.00")
    watchlist_id = _create_watchlist(client).json()["id"]
    stock_a = _add_stock(client, watchlist_id, "ZZALPHA").json()
    stock_b = _add_stock(client, watchlist_id, "ZZBETA").json()

    _use_provider({"ZZALPHA": _quote(symbol="ZZALPHA", price="1000.00"), "ZZBETA": _quote(symbol="ZZBETA", price="1000.00")})
    assert _seen(client, watchlist_id).status_code == 200  # establish both baselines

    import app.services.market_snapshots as market_snapshots_module

    original_record_user_stock_seen = market_snapshots_module.record_user_stock_seen
    call_count = {"n": 0}

    def _boom(db, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 2:
            raise RuntimeError("simulated database failure")
        return original_record_user_stock_seen(db, **kwargs)

    monkeypatch.setattr(market_snapshots_module, "record_user_stock_seen", _boom)

    _use_provider(
        {"ZZALPHA": _quote(symbol="ZZALPHA", price="1100.00"), "ZZBETA": _quote(symbol="ZZBETA", price="1100.00")}
    )
    with pytest.raises(RuntimeError):
        _seen(client, watchlist_id)

    # Neither stock's second-round ChangeEvent, snapshot, or updated state
    # survives -- the whole batch rolled back, not just the failing stock.
    for stock in (stock_a, stock_b):
        event_count = db_session.execute(
            select(func.count()).select_from(ChangeEvent).where(ChangeEvent.stock_id == stock["id"])
        ).scalar_one()
        assert event_count == 0, "no ChangeEvent should survive a rolled-back batch"

        snapshot_count = db_session.execute(
            select(func.count()).select_from(MarketSnapshot).where(MarketSnapshot.stock_id == stock["id"])
        ).scalar_one()
        assert snapshot_count == 1, "only the first (already-committed) baseline snapshot should remain"

    db_session.expire_all()
    state = db_session.execute(
        select(UserStockState).where(
            UserStockState.user_id == user["id"], UserStockState.stock_id == stock_a["id"]
        )
    ).scalar_one()
    assert state.last_seen_price == Decimal("1000.00"), "state must still reflect the first, committed baseline"


# ---------------------------------------------------------------------------
# 25 (detected_at) already covered above; final: full API response shape.
# ---------------------------------------------------------------------------


def test_response_exposes_structured_change_data_without_internals(client, db_session):
    user = _register(client)
    _set_preference(db_session, user["id"], price_change_threshold="3.00")
    watchlist_id = _create_watchlist(client).json()["id"]
    stock = _add_stock(client, watchlist_id, "ZZALPHA").json()

    _use_provider({"ZZALPHA": _quote(price="1000.00")})
    assert _seen(client, watchlist_id).status_code == 200

    _use_provider({"ZZALPHA": _quote(price="1100.00")})
    body = _seen(client, watchlist_id).json()

    assert body["detected"] == 1
    change = body["changes"][0]
    assert set(change.keys()) == {
        "stock_id",
        "symbol",
        "type",
        "severity",
        "title",
        "description",
        "old_value",
        "new_value",
        "detected_at",
    }
    assert change["stock_id"] == stock["id"]
