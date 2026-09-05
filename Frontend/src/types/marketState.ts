/** Mirrors the backend's ChangeEventType/ChangeEventSeverity enums (Phase
 * 6A). Loosely typed (not a strict union) so an unknown future value never
 * breaks the build or crashes at runtime -- callers should handle anything
 * outside the known set gracefully (see MeaningfulChanges.tsx). */
export type ChangeEventType = 'PRICE_CHANGE' | 'VOLUME_SPIKE' | (string & {});
export type ChangeEventSeverity = 'HIGH' | 'MEDIUM' | 'LOW' | 'CRITICAL' | (string & {});

/** Mirrors the backend's ChangeEventSummary (Phase 6A). `old_value`/
 * `new_value` arrive as JSON strings, same Decimal-as-string convention as
 * QuoteResponse -- never parsed/recalculated here, only compared or passed
 * through; the backend's `title`/`description` remain the source of truth
 * for what actually happened. */
export interface ChangeEventSummary {
  stock_id: string;
  symbol: string;
  type: ChangeEventType;
  severity: ChangeEventSeverity;
  title: string;
  description: string;
  old_value: string;
  new_value: string;
  detected_at: string;
}

/** Mirrors the backend's MarketSignalType/MarketSignalSummary (Phase 6C).
 * Deliberately a separate shape from ChangeEventSummary: no old_value/
 * new_value (there is no "since you last checked" comparison here), and
 * never backed by a persisted ChangeEvent -- purely a current-quote
 * condition (e.g. "trading near today's low"). */
export type MarketSignalType = 'NEAR_DAY_LOW' | (string & {});

export interface MarketSignalSummary {
  stock_id: string;
  symbol: string;
  type: MarketSignalType;
  severity: ChangeEventSeverity;
  title: string;
  description: string;
  detected_at: string;
}

/** Mirrors the backend's WatchlistMarketStateResult (Phase 5A/6A/6C:
 * POST /api/watchlists/{id}/market-state/seen). `processed`/`successful`/
 * `failed`/`seen_at` etc. are internal bookkeeping only -- never surfaced to
 * the user as "snapshot saved"/"state recorded" UI. `detected`/`changes`
 * (Phase 6A) are personalized, persisted meaningful changes, shown via
 * MeaningfulChanges.tsx. `market_signals` (Phase 6C) are ephemeral,
 * current-quote-only conditions -- never counted as meaningful changes,
 * never persisted -- shown in their own separate "Market Signals" section. */
export interface WatchlistMarketStateResult {
  watchlist_id: string;
  processed: number;
  successful: number;
  failed: number;
  failed_symbols: string[];
  seen_at: string;
  detected: number;
  changes: ChangeEventSummary[];
  market_signals: MarketSignalSummary[];
}
