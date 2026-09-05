import enum
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class HistoryPeriod(str, enum.Enum):
    """Supported historical lookback windows. Deliberately a small fixed
    set for this foundation phase -- not arbitrary date-range support."""

    ONE_DAY = "1D"
    ONE_WEEK = "1W"
    ONE_MONTH = "1M"
    THREE_MONTHS = "3M"
    ONE_YEAR = "1Y"


class StockSearchResult(BaseModel):
    """A single search match. Provider-independent: no FYERS-specific
    field names leak out of this schema."""

    model_config = ConfigDict(from_attributes=True)

    symbol: str
    company_name: str
    exchange: str
    # Opaque provider-internal identifier (e.g. the FYERS ticker
    # "NSE:RELIANCE-EQ"). Callers should treat this as a pass-through
    # value, not parse it.
    instrument_key: str


class QuoteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    symbol: str
    price: Decimal
    previous_close: Decimal | None
    day_high: Decimal | None
    day_low: Decimal | None
    volume: int | None
    average_volume: int | None
    change: Decimal | None
    change_percent: Decimal | None
    timestamp: datetime
    data_source: str
    is_delayed: bool


class HistoricalCandle(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    timestamp: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int


class HistoricalResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    symbol: str
    period: HistoryPeriod
    data_source: str
    candles: list[HistoricalCandle]
