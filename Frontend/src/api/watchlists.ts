import { request } from './client';
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
