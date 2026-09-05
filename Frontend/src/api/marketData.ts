import { request } from './client';
import type { HistoricalResponse, HistoryPeriod, QuoteResponse, StockSearchResult } from '../types/marketData';

export function searchStocks(query: string): Promise<StockSearchResult[]> {
  return request<StockSearchResult[]>(`/api/market-data/search?q=${encodeURIComponent(query)}`);
}

export function getQuote(symbol: string): Promise<QuoteResponse> {
  return request<QuoteResponse>(`/api/market-data/quote/${encodeURIComponent(symbol)}`);
}

export function getHistory(symbol: string, period: HistoryPeriod = '1M'): Promise<HistoricalResponse> {
  return request<HistoricalResponse>(
    `/api/market-data/history/${encodeURIComponent(symbol)}?period=${encodeURIComponent(period)}`,
  );
}
