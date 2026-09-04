import re
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

_SYMBOL_RE = re.compile(r"^[A-Z0-9.\-]{1,20}$")


def _trimmed_non_empty_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("name must not be empty")
    return value


class WatchlistCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str) -> str:
        return _trimmed_non_empty_name(value)


class WatchlistUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=255)

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str) -> str:
        return _trimmed_non_empty_name(value)


class WatchlistSummary(BaseModel):
    """Response for list/create/update -- no per-stock detail."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    stock_count: int
    created_at: datetime
    updated_at: datetime


class WatchlistStock(BaseModel):
    """A stock as it appears within a watchlist. Metadata fields are
    nullable -- this phase does not populate market data, so a freshly
    added stock may only have a symbol."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    symbol: str
    company_name: str | None
    exchange: str | None
    position: int


class WatchlistDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    stocks: list[WatchlistStock]
    created_at: datetime
    updated_at: datetime


class AddStockRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)

    @field_validator("symbol")
    @classmethod
    def _validate_symbol(cls, value: str) -> str:
        value = value.strip().upper()
        if not _SYMBOL_RE.fullmatch(value):
            raise ValueError(
                "symbol must be 1-20 characters: uppercase letters, digits, '.' or '-'"
            )
        return value


class ReorderStocksRequest(BaseModel):
    stock_ids: list[uuid.UUID]

    @field_validator("stock_ids")
    @classmethod
    def _no_duplicates(cls, value: list[uuid.UUID]) -> list[uuid.UUID]:
        if len(value) != len(set(value)):
            raise ValueError("stock_ids must not contain duplicates")
        return value
