export interface WatchlistSummary {
  id: string;
  name: string;
  stock_count: number;
  created_at: string;
  updated_at: string;
}

export interface WatchlistStock {
  id: string;
  symbol: string;
  company_name: string | null;
  exchange: string | null;
  position: number;
}

export interface WatchlistDetail {
  id: string;
  name: string;
  stocks: WatchlistStock[];
  created_at: string;
  updated_at: string;
}

export interface CreateWatchlistRequest {
  name: string;
}

export interface RenameWatchlistRequest {
  name: string;
}

export interface AddStockRequest {
  symbol: string;
}

export interface ReorderStocksRequest {
  stock_ids: string[];
}
