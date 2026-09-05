"""FYERS API v3 implementation of MarketDataProvider.

Two distinct data sources are used:

- Stock search uses FYERS' public, unauthenticated "symbol master" CSV
  (https://public.fyers.in/sym_details/NSE_CM.csv) -- there is no live
  search endpoint in FYERS API v3. This also doubles as the symbol ->
  FYERS-ticker lookup used by get_quote/get_history, so a short symbol like
  "RELIANCE" (matching our own Stock.symbol convention) resolves to the
  FYERS ticker "NSE:RELIANCE-EQ" from the same real, provider-supplied data
  -- never a guessed or fabricated mapping.
- Quotes and history use the authenticated FyersModel SDK client, which
  requires FYERS_APP_ID + FYERS_ACCESS_TOKEN to be configured.

Field names for the quotes/history responses (s/d/v/lp/ch/chp/
prev_close_price/high_price/low_price/volume/candles) are taken from
FYERS' own published API v3 documentation. They have not been exercised
against a live authenticated call in this environment (see the README's
FYERS section) -- parsing is deliberately defensive: any unexpected shape
raises MalformedProviderResponseError rather than guessing at a value.
"""

import csv
import io
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import ClassVar

import requests
from fyers_apiv3 import fyersModel

from app.config import Settings
from app.providers.market_data import (
    InvalidQueryError,
    InvalidSymbolError,
    MalformedProviderResponseError,
    MarketDataProvider,
    ProviderAuthenticationError,
    ProviderUnavailableError,
    RateLimitedError,
)
from app.schemas.market_data import HistoricalCandle, HistoricalResponse, HistoryPeriod, QuoteResponse, StockSearchResult

_SYMBOL_MASTER_URL = "https://public.fyers.in/sym_details/NSE_CM.csv"
_MAX_SEARCH_RESULTS = 20

# period -> (FYERS resolution, lookback window in days)
_PERIOD_CONFIG: dict[HistoryPeriod, tuple[str, int]] = {
    HistoryPeriod.ONE_DAY: ("5", 1),
    HistoryPeriod.ONE_WEEK: ("15", 7),
    HistoryPeriod.ONE_MONTH: ("60", 30),
    HistoryPeriod.THREE_MONTHS: ("D", 90),
    HistoryPeriod.ONE_YEAR: ("D", 365),
}


@dataclass(frozen=True)
class _SymbolRecord:
    symbol: str
    company_name: str
    exchange: str
    ticker: str


def _to_decimal(value: object) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise MalformedProviderResponseError(f"Could not parse numeric value: {value!r}") from exc


def _to_decimal_or_none(value: object) -> Decimal | None:
    return None if value is None else _to_decimal(value)


def _to_int_or_none(value: object) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (ValueError, TypeError) as exc:
        raise MalformedProviderResponseError(f"Could not parse integer value: {value!r}") from exc


def _looks_like_auth_error(raw: object) -> bool:
    if not isinstance(raw, dict):
        return False
    message = str(raw.get("message", "")).lower()
    return "token" in message or "auth" in message


class FYERSProvider(MarketDataProvider):
    """Only market-data functionality is used here -- no order/trading APIs."""

    _symbol_cache: ClassVar[dict[str, _SymbolRecord] | None] = None

    def __init__(self, settings: Settings):
        self._settings = settings
        self._client: fyersModel.FyersModel | None = None

    def _get_client(self) -> fyersModel.FyersModel:
        if self._client is not None:
            return self._client

        if not self._settings.fyers_app_id or not self._settings.fyers_access_token:
            raise ProviderUnavailableError(
                "FYERS is not configured (missing FYERS_APP_ID or FYERS_ACCESS_TOKEN)."
            )

        # log_level suppresses FYERS' own response/body logging; it does not
        # write credentials to its (harmless, status-code-only) request log.
        self._client = fyersModel.FyersModel(
            client_id=self._settings.fyers_app_id,
            token=self._settings.fyers_access_token,
            is_async=False,
            log_level="CRITICAL",
        )
        return self._client

    def _ensure_symbol_master(self) -> dict[str, _SymbolRecord]:
        cls = type(self)
        if cls._symbol_cache is not None:
            return cls._symbol_cache

        try:
            response = requests.get(_SYMBOL_MASTER_URL, timeout=15)
            response.raise_for_status()
        except requests.RequestException as exc:
            raise ProviderUnavailableError("Could not fetch the FYERS symbol master.") from exc

        records: dict[str, _SymbolRecord] = {}
        for row in csv.reader(io.StringIO(response.text)):
            if len(row) < 14:
                continue
            ticker = row[9].strip()
            short_symbol = row[13].strip().upper()
            company_name = row[1].strip()
            if not ticker or ":" not in ticker or not short_symbol or not company_name:
                continue
            exchange = ticker.split(":", 1)[0]
            records[short_symbol] = _SymbolRecord(
                symbol=short_symbol, company_name=company_name, exchange=exchange, ticker=ticker
            )

        if not records:
            raise MalformedProviderResponseError("The FYERS symbol master could not be parsed.")

        cls._symbol_cache = records
        return records

    def _resolve(self, symbol: str) -> _SymbolRecord:
        key = symbol.strip().upper()
        record = self._ensure_symbol_master().get(key)
        if record is None:
            raise InvalidSymbolError(symbol)
        return record

    def search_stocks(self, query: str) -> list[StockSearchResult]:
        normalized = query.strip()
        if not normalized:
            raise InvalidQueryError("Search query must not be empty.")

        query_upper = normalized.upper()
        records = self._ensure_symbol_master()
        matches = [
            r
            for r in records.values()
            if query_upper in r.symbol or query_upper in r.company_name.upper()
        ]
        matches.sort(key=lambda r: (not r.symbol.startswith(query_upper), r.symbol))

        return [
            StockSearchResult(
                symbol=r.symbol, company_name=r.company_name, exchange=r.exchange, instrument_key=r.ticker
            )
            for r in matches[:_MAX_SEARCH_RESULTS]
        ]

    def get_quote(self, symbol: str) -> QuoteResponse:
        record = self._resolve(symbol)
        client = self._get_client()

        try:
            raw = client.quotes({"symbols": record.ticker})
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else None
            if status == 429:
                raise RateLimitedError("FYERS rate-limited this request.") from exc
            if status in (401, 403):
                raise ProviderAuthenticationError("FYERS rejected the configured access token.") from exc
            raise ProviderUnavailableError(f"FYERS quotes request failed (HTTP {status}).") from exc
        except requests.RequestException as exc:
            raise ProviderUnavailableError("Could not reach FYERS.") from exc

        if not isinstance(raw, dict) or raw.get("s") != "ok":
            if _looks_like_auth_error(raw):
                raise ProviderAuthenticationError("FYERS rejected the configured access token.")
            raise MalformedProviderResponseError(f"Unexpected FYERS quotes response: {raw!r}")

        entries = raw.get("d")
        if not isinstance(entries, list) or not entries:
            raise MalformedProviderResponseError("FYERS quotes response had no data.")

        entry = entries[0]
        if not isinstance(entry, dict) or entry.get("s") != "ok":
            raise InvalidSymbolError(symbol)

        values = entry.get("v")
        if not isinstance(values, dict) or "lp" not in values:
            raise MalformedProviderResponseError("FYERS quotes response missing expected fields.")

        price = _to_decimal(values["lp"])
        previous_close = _to_decimal_or_none(values.get("prev_close_price"))
        change = _to_decimal_or_none(values.get("ch"))
        change_percent = _to_decimal_or_none(values.get("chp"))

        if change is None and previous_close is not None and previous_close != 0:
            change = price - previous_close
            change_percent = (change / previous_close) * Decimal(100)

        timestamp_raw = values.get("tt")
        timestamp = (
            datetime.fromtimestamp(int(timestamp_raw), tz=timezone.utc)
            if timestamp_raw is not None
            else datetime.now(timezone.utc)
        )

        return QuoteResponse(
            symbol=record.symbol,
            price=price,
            previous_close=previous_close,
            day_high=_to_decimal_or_none(values.get("high_price")),
            day_low=_to_decimal_or_none(values.get("low_price")),
            volume=_to_int_or_none(values.get("volume")),
            # FYERS' live quote does not provide an average-volume figure;
            # never fabricate one.
            average_volume=None,
            change=change,
            change_percent=change_percent,
            timestamp=timestamp,
            data_source="FYERS",
            is_delayed=False,
        )

    def get_history(self, symbol: str, period: HistoryPeriod) -> HistoricalResponse:
        record = self._resolve(symbol)
        resolution, days = _PERIOD_CONFIG[period]
        range_to = date.today()
        range_from = range_to - timedelta(days=days)
        client = self._get_client()

        try:
            raw = client.history(
                {
                    "symbol": record.ticker,
                    "resolution": resolution,
                    "date_format": 1,
                    "range_from": range_from.isoformat(),
                    "range_to": range_to.isoformat(),
                    "cont_flag": 1,
                }
            )
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else None
            if status == 429:
                raise RateLimitedError("FYERS rate-limited this request.") from exc
            if status in (401, 403):
                raise ProviderAuthenticationError("FYERS rejected the configured access token.") from exc
            raise ProviderUnavailableError(f"FYERS history request failed (HTTP {status}).") from exc
        except requests.RequestException as exc:
            raise ProviderUnavailableError("Could not reach FYERS.") from exc

        if not isinstance(raw, dict) or raw.get("s") not in ("ok", "no_data"):
            if _looks_like_auth_error(raw):
                raise ProviderAuthenticationError("FYERS rejected the configured access token.")
            raise MalformedProviderResponseError(f"Unexpected FYERS history response: {raw!r}")

        candles_raw = raw.get("candles", [])
        if not isinstance(candles_raw, list):
            raise MalformedProviderResponseError("FYERS history response had a malformed candles field.")

        candles: list[HistoricalCandle] = []
        for row in candles_raw:
            if not isinstance(row, (list, tuple)) or len(row) < 6:
                raise MalformedProviderResponseError(f"Malformed candle row: {row!r}")
            ts, o, h, l, c, v = row[:6]
            candles.append(
                HistoricalCandle(
                    timestamp=datetime.fromtimestamp(int(ts), tz=timezone.utc),
                    open=_to_decimal(o),
                    high=_to_decimal(h),
                    low=_to_decimal(l),
                    close=_to_decimal(c),
                    volume=_to_int_or_none(v) or 0,
                )
            )

        return HistoricalResponse(symbol=record.symbol, period=period, data_source="FYERS", candles=candles)
