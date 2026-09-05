import enum


class ChangeEventType(str, enum.Enum):
    PRICE_CHANGE = "PRICE_CHANGE"
    VOLUME_SPIKE = "VOLUME_SPIKE"
    NEWS = "NEWS"
    EARNINGS = "EARNINGS"
    DIVIDEND = "DIVIDEND"
    SPLIT = "SPLIT"
    GUIDANCE = "GUIDANCE"
    ANALYST_UPDATE = "ANALYST_UPDATE"
    OTHER = "OTHER"


class ChangeEventSeverity(str, enum.Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class MarketEventType(str, enum.Enum):
    EARNINGS = "EARNINGS"
    DIVIDEND = "DIVIDEND"
    SPLIT = "SPLIT"
    GUIDANCE = "GUIDANCE"
    ANALYST_UPDATE = "ANALYST_UPDATE"


class MarketSignalType(str, enum.Enum):
    """Phase 6C: ephemeral, current-quote-only conditions -- deliberately a
    separate enum from ChangeEventType, since these are never persisted as
    ChangeEvent rows and never compared against a user's baseline (see
    app/services/market_signals.py)."""

    NEAR_DAY_LOW = "NEAR_DAY_LOW"
