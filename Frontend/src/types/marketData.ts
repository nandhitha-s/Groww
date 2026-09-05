export type HistoryPeriod = '1D' | '1W' | '1M' | '3M' | '1Y';

export interface StockSearchResult {
  symbol: string;
  company_name: string;
  exchange: string;
  instrument_key: string;
}

/**
 * Decimal-typed backend fields (price, previous_close, day_high, day_low,
 * change, change_percent) arrive as JSON strings, not numbers -- FastAPI
 * serializes Python `Decimal` values as strings to avoid float precision
 * loss. `volume`/`average_volume` are plain ints and stay numbers.
 */
export interface QuoteResponse {
  symbol: string;
  price: string;
  previous_close: string | null;
  day_high: string | null;
  day_low: string | null;
  volume: number | null;
  average_volume: number | null;
  change: string | null;
  change_percent: string | null;
  timestamp: string;
  data_source: string;
  is_delayed: boolean;
}

export interface HistoricalCandle {
  timestamp: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: number;
}

export interface HistoricalResponse {
  symbol: string;
  period: HistoryPeriod;
  data_source: string;
  candles: HistoricalCandle[];
}

/** Per-symbol quote-fetch state for the watchlist detail page -- keyed by
 * symbol so one stock's failure never affects another's. */
export type QuoteState =
  | { status: 'loading' }
  | { status: 'success'; data: QuoteResponse }
  | { status: 'error'; message: string };
