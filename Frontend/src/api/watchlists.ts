import { request } from './client';
import type { WatchlistMarketStateResult } from '../types/marketState';
import type { WatchlistDetail, WatchlistStock, WatchlistSummary } from '../types/watchlist';

export function getWatchlists(): Promise<WatchlistSummary[]> {
  return request<WatchlistSummary[]>('/api/watchlists');
}

export function createWatchlist(name: string): Promise<WatchlistSummary> {
  return request<WatchlistSummary>('/api/watchlists', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function getWatchlist(id: string): Promise<WatchlistDetail> {
  return request<WatchlistDetail>(`/api/watchlists/${id}`);
}

export function renameWatchlist(id: string, name: string): Promise<WatchlistSummary> {
  return request<WatchlistSummary>(`/api/watchlists/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export function deleteWatchlist(id: string): Promise<void> {
  return request<void>(`/api/watchlists/${id}`, { method: 'DELETE' });
}

export function addStock(watchlistId: string, symbol: string): Promise<WatchlistStock> {
  return request<WatchlistStock>(`/api/watchlists/${watchlistId}/stocks`, {
    method: 'POST',
    body: JSON.stringify({ symbol }),
  });
}

export function removeStock(watchlistId: string, symbol: string): Promise<void> {
  return request<void>(`/api/watchlists/${watchlistId}/stocks/${encodeURIComponent(symbol)}`, {
    method: 'DELETE',
  });
}

export function reorderStocks(watchlistId: string, stockIds: string[]): Promise<WatchlistDetail> {
  return request<WatchlistDetail>(`/api/watchlists/${watchlistId}/stocks/reorder`, {
    method: 'PATCH',
    body: JSON.stringify({ stock_ids: stockIds }),
  });
}

/** Records the watchlist's current market state as observed and explicitly
 * seen by the current user (Phase 5A). Fire-and-forget from the caller's
 * perspective -- never blocks or gates the watchlist UI itself. */
export function recordWatchlistSeen(watchlistId: string): Promise<WatchlistMarketStateResult> {
  return request<WatchlistMarketStateResult>(`/api/watchlists/${watchlistId}/market-state/seen`, {
    method: 'POST',
  });
}
