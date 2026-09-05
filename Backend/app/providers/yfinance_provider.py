"""Yahoo Finance (via the `yfinance` library) implementation of
MarketDataProvider.

Selected over FYERS for this phase: it needs **no credentials at all** (no
API key, no broker account, no interactive OAuth, no daily token refresh)
and has excellent, verified NSE/BSE coverage -- see the README's "Market
data provider" section for the full comparison and the reasoning.

Trade-off, stated plainly: `yfinance` wraps Yahoo Finance's unofficial,
undocumented endpoints. There is no formal SLA and Yahoo could change or
throttle them without notice. For a project at this stage that is a better
trade than requiring every developer to hold a live broker account and
re-authenticate daily just to run the backend.

Symbol resolution: our own Stock.symbol convention is a bare short symbol
(e.g. "RELIANCE"), never a suffixed ticker. Yahoo tickers need an exchange
suffix (".NS" for NSE, ".BO" for BSE). Rather than downloading and indexing
a full symbol master (as the FYERS provider does), this provider resolves a
bare symbol by trying NSE first, then falling back to BSE -- correct for
the vast majority of actively-traded Indian equities (most are NSE-listed;
this project's primary market), which are also the only kind users can
actually add via search (search results carry their own real exchange
suffix as `instrument_key`, so a stock added by search always resolves
correctly on the first try).
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

import yfinance as yf
from yfinance.exceptions import YFException, YFRateLimitError

from app.providers.market_data import (
    InvalidQueryError,
    InvalidSymbolError,
    MalformedProviderResponseError,
    MarketDataProvider,
    ProviderUnavailableError,
    RateLimitedError,
)
from app.schemas.market_data import HistoricalCandle, HistoricalResponse, HistoryPeriod, QuoteResponse, StockSearchResult

_MAX_SEARCH_RESULTS = 20
_INDIAN_EXCHANGES = {"NSI": "NSE", "BSE": "BSE"}
_FALLBACK_SUFFIXES = (".NS", ".BO")

# period -> (yfinance period, yfinance interval)
_PERIOD_CONFIG: dict[HistoryPeriod, tuple[str, str]] = {
    HistoryPeriod.ONE_DAY: ("1d", "5m"),
    HistoryPeriod.ONE_WEEK: ("5d", "15m"),
    HistoryPeriod.ONE_MONTH: ("1mo", "60m"),
    HistoryPeriod.THREE_MONTHS: ("3mo", "1d"),
    HistoryPeriod.ONE_YEAR: ("1y", "1d"),
}


@dataclass(frozen=True)
class _ResolvedTicker:
    short_symbol: str
    yahoo_symbol: str
    ticker: "yf.Ticker"


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


class YFinanceProvider(MarketDataProvider):
    """Requires no configuration/settings at all -- Yahoo Finance's
    unofficial endpoints need no API key."""

    def search_stocks(self, query: str) -> list[StockSearchResult]:
        normalized = query.strip()
        if not normalized:
            raise InvalidQueryError("Search query must not be empty.")

        try:
            results = yf.Search(normalized, max_results=_MAX_SEARCH_RESULTS).quotes
        except YFRateLimitError as exc:
            raise RateLimitedError("Yahoo Finance rate-limited this request.") from exc
        except YFException as exc:
            raise ProviderUnavailableError("Could not reach Yahoo Finance.") from exc
        except Exception as exc:  # network-level failures yfinance doesn't wrap
            raise ProviderUnavailableError("Could not reach Yahoo Finance.") from exc

        if not isinstance(results, list):
            raise MalformedProviderResponseError("Unexpected Yahoo Finance search response.")

        matches: list[StockSearchResult] = []
        for entry in results:
            if not isinstance(entry, dict):
                continue
            exchange_code = entry.get("exchange")
            exchange = _INDIAN_EXCHANGES.get(exchange_code)
            symbol = entry.get("symbol")
            if not exchange or not symbol or "." not in symbol:
                continue
            company_name = entry.get("longname") or entry.get("shortname")
            if not company_name:
                continue
            matches.append(
                StockSearchResult(
                    symbol=symbol.split(".", 1)[0].upper(),
                    company_name=company_name,
                    exchange=exchange,
                    instrument_key=symbol,
                )
            )

        return matches[:_MAX_SEARCH_RESULTS]

    def _resolve_for_quote(self, symbol: str) -> _ResolvedTicker:
        short_symbol = symbol.strip().upper()
        last_error: Exception | None = None
        for suffix in _FALLBACK_SUFFIXES:
            yahoo_symbol = f"{short_symbol}{suffix}"
            ticker = yf.Ticker(yahoo_symbol)
            try:
                fast_info = ticker.fast_info
                _ = fast_info.last_price  # forces the lazy fetch; raises if invalid
                return _ResolvedTicker(short_symbol, yahoo_symbol, ticker)
            except YFRateLimitError as exc:
                raise RateLimitedError("Yahoo Finance rate-limited this request.") from exc
            except (KeyError, YFException) as exc:
                # yfinance's documented failure mode for an invalid/delisted
                # ticker: a bare KeyError('currentTradingPeriod'), or one of
                # its own "no data" exception types. Try the next suffix.
                last_error = exc
                continue
            except Exception as exc:
                # Anything else (network failure, etc.) is a real outage --
                # don't misreport it as an invalid symbol.
                raise ProviderUnavailableError("Could not reach Yahoo Finance.") from exc
        raise InvalidSymbolError(symbol) from last_error

    def get_quote(self, symbol: str) -> QuoteResponse:
        resolved = self._resolve_for_quote(symbol)

        try:
            fast_info = resolved.ticker.fast_info
            price = _to_decimal(fast_info.last_price)
            previous_close = _to_decimal_or_none(fast_info.get("previousClose"))
            day_high = _to_decimal_or_none(fast_info.get("dayHigh"))
            day_low = _to_decimal_or_none(fast_info.get("dayLow"))
            volume = _to_int_or_none(fast_info.get("lastVolume"))
            average_volume = _to_int_or_none(fast_info.get("threeMonthAverageVolume"))
        except YFRateLimitError as exc:
            raise RateLimitedError("Yahoo Finance rate-limited this request.") from exc
        except MalformedProviderResponseError:
            raise
        except Exception as exc:
            raise MalformedProviderResponseError("Could not parse the Yahoo Finance quote.") from exc

        change: Decimal | None = None
        change_percent: Decimal | None = None
        if previous_close is not None and previous_close != 0:
            change = price - previous_close
            change_percent = (change / previous_close) * Decimal(100)

        return QuoteResponse(
            symbol=resolved.short_symbol,
            price=price,
            previous_close=previous_close,
            day_high=day_high,
            day_low=day_low,
            volume=volume,
            average_volume=average_volume,
            change=change,
            change_percent=change_percent,
            # Yahoo's fast_info doesn't expose the exact tick time; this is
            # when *we* observed the quote, not a provider-supplied tick time.
            timestamp=datetime.now(timezone.utc),
            data_source="Yahoo Finance",
            # Yahoo Finance's free/unofficial data is well-documented to be
            # delayed (commonly ~15 minutes for NSE/BSE) -- not real-time.
            is_delayed=True,
        )

    def get_history(self, symbol: str, period: HistoryPeriod) -> HistoricalResponse:
        short_symbol = symbol.strip().upper()
        yf_period, yf_interval = _PERIOD_CONFIG[period]

        frame = None
        last_error: Exception | None = None
        for suffix in _FALLBACK_SUFFIXES:
            yahoo_symbol = f"{short_symbol}{suffix}"
            try:
                candidate = yf.Ticker(yahoo_symbol).history(period=yf_period, interval=yf_interval)
            except YFRateLimitError as exc:
                raise RateLimitedError("Yahoo Finance rate-limited this request.") from exc
            except YFException as exc:
                # yfinance's own "no data for this ticker" signal -- try the
                # next suffix rather than failing outright.
                last_error = exc
                continue
            except Exception as exc:
                # Anything else (network failure, etc.) is a real outage --
                # don't misreport it as an invalid symbol.
                raise ProviderUnavailableError("Could not reach Yahoo Finance.") from exc
            if candidate is not None and not candidate.empty:
                frame = candidate
                break

        if frame is None:
            raise InvalidSymbolError(symbol) from last_error

        candles: list[HistoricalCandle] = []
        try:
            for row_timestamp, row in frame.iterrows():
                candles.append(
                    HistoricalCandle(
                        timestamp=row_timestamp.to_pydatetime(),
                        open=_to_decimal(row["Open"]),
                        high=_to_decimal(row["High"]),
                        low=_to_decimal(row["Low"]),
                        close=_to_decimal(row["Close"]),
                        volume=_to_int_or_none(row["Volume"]) or 0,
                    )
                )
        except (KeyError, MalformedProviderResponseError) as exc:
            raise MalformedProviderResponseError("Could not parse Yahoo Finance candle data.") from exc

        return HistoricalResponse(
            symbol=short_symbol, period=period, data_source="Yahoo Finance", candles=candles
        )
