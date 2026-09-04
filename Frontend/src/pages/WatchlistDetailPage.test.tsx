import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { WatchlistDetailPage } from './WatchlistDetailPage';
import { mockUser, renderWithProviders } from '../test/testUtils';
import type { WatchlistStock } from '../types/watchlist';

vi.mock('../api/auth', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    meRequest: vi.fn(),
    loginRequest: vi.fn(),
    registerRequest: vi.fn(),
    logoutRequest: vi.fn(),
    ApiError: actual.ApiError,
  };
});

vi.mock('../api/watchlists', () => ({
  getWatchlists: vi.fn(),
  getWatchlist: vi.fn(),
  createWatchlist: vi.fn(),
  renameWatchlist: vi.fn(),
  deleteWatchlist: vi.fn(),
  addStock: vi.fn(),
  removeStock: vi.fn(),
  reorderStocks: vi.fn(),
}));

// StockList's real drag mechanics rely on dnd-kit's pointer geometry, which
// jsdom does not lay out -- so for reorder tests we swap in a stand-in that
// exposes the same onReorder contract via a plain button, letting us test
// WatchlistDetailPage's own optimistic-update/rollback logic directly. dnd-kit
// itself is a mature, separately-tested library.
vi.mock('../components/watchlists/StockList', () => ({
  StockList: ({
    stocks,
    onReorder,
    onRemove,
  }: {
    stocks: WatchlistStock[];
    onReorder: (next: WatchlistStock[]) => void;
    onRemove: (symbol: string) => void;
  }): ReactNode => (
    <div>
      {stocks.map((s) => (
        <div key={s.id}>
          <span>{s.symbol}</span>
          <button onClick={() => onRemove(s.symbol)}>Remove {s.symbol}</button>
        </div>
      ))}
      <button onClick={() => onReorder([...stocks].reverse())}>Simulate reorder</button>
    </div>
  ),
}));

import { meRequest } from '../api/auth';
import { ApiError } from '../api/client';
import {
  addStock,
  deleteWatchlist,
  getWatchlist,
  removeStock,
  renameWatchlist,
  reorderStocks,
} from '../api/watchlists';

const stock = (overrides: Partial<WatchlistStock> = {}): WatchlistStock => ({
  id: 's1',
  symbol: 'NVDA',
  company_name: 'NVIDIA Corporation',
  exchange: 'NASDAQ',
  position: 0,
  ...overrides,
});

const detail = (stocks: WatchlistStock[] = [stock()]) => ({
  id: 'w1',
  name: 'Technology',
  stocks,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

beforeEach(() => {
  vi.mocked(meRequest).mockResolvedValue(mockUser);
});

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path="/watchlists/:watchlistId" element={<WatchlistDetailPage />} />
    </Routes>,
    { route: '/watchlists/w1' },
  );
}

describe('WatchlistDetailPage', () => {
  it('loads and renders the watchlist with its stocks', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail());

    renderDetail();

    expect(await screen.findByText('Technology')).toBeInTheDocument();
    expect(screen.getByText('NVDA')).toBeInTheDocument();
    expect(screen.getByText('1 stock')).toBeInTheDocument();
  });

  it('shows the empty state when the watchlist has no stocks', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail([]));

    renderDetail();

    expect(await screen.findByText('No stocks yet')).toBeInTheDocument();
  });

  it('shows a not-found state for a 404', async () => {
    vi.mocked(getWatchlist).mockRejectedValueOnce(new ApiError(404, 'Watchlist not found'));

    renderDetail();

    expect(await screen.findByText('Watchlist not found')).toBeInTheDocument();
  });

  it('adds a stock and shows a success toast', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail([]));
    vi.mocked(addStock).mockResolvedValueOnce(stock({ id: 's2', symbol: 'AAPL', company_name: null, exchange: null }));

    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: /Add Stock/i }));
    await userEvent.type(screen.getByLabelText('Stock symbol'), 'aapl');
    await userEvent.click(screen.getByRole('button', { name: 'Add stock' }));

    expect(await screen.findByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('AAPL added to Technology')).toBeInTheDocument();
  });

  it('shows an inline error for a duplicate stock', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail());
    vi.mocked(addStock).mockRejectedValueOnce(new ApiError(409, 'This stock is already in the watchlist'));

    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: /Add Stock/i }));
    await userEvent.type(screen.getByLabelText('Stock symbol'), 'NVDA');
    await userEvent.click(screen.getByRole('button', { name: 'Add stock' }));

    expect(await screen.findByText('This stock is already in the watchlist.')).toBeInTheDocument();
  });

  it('removes a stock and shows a success toast', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail());
    vi.mocked(removeStock).mockResolvedValueOnce(undefined);

    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: 'Remove NVDA' }));

    await waitFor(() => expect(screen.queryByText('NVDA')).not.toBeInTheDocument());
    expect(screen.getByText('NVDA removed')).toBeInTheDocument();
  });

  it('renames the watchlist', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail());
    vi.mocked(renameWatchlist).mockResolvedValueOnce({
      id: 'w1',
      name: 'US Technology',
      stock_count: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    });

    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: 'Open Technology watchlist menu' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByLabelText('Watchlist name');
    await userEvent.clear(input);
    await userEvent.type(input, 'US Technology');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('US Technology')).toBeInTheDocument();
    expect(screen.getByText('Watchlist renamed')).toBeInTheDocument();
  });

  it('deletes the watchlist and navigates away', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail());
    vi.mocked(deleteWatchlist).mockResolvedValueOnce(undefined);

    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: 'Open Technology watchlist menu' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete watchlist' }));

    await waitFor(() => expect(deleteWatchlist).toHaveBeenCalledWith('w1'));
  });

  it('reorders stocks and persists the new order', async () => {
    const stocks = [stock({ id: 's1', symbol: 'NVDA', position: 0 }), stock({ id: 's2', symbol: 'AAPL', position: 1 })];
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail(stocks));
    vi.mocked(reorderStocks).mockResolvedValueOnce(
      detail([stock({ id: 's2', symbol: 'AAPL', position: 0 }), stock({ id: 's1', symbol: 'NVDA', position: 1 })]),
    );

    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: 'Simulate reorder' }));

    await waitFor(() => expect(reorderStocks).toHaveBeenCalledWith('w1', ['s2', 's1']));
  });

  it('rolls back the order if the reorder request fails', async () => {
    const stocks = [stock({ id: 's1', symbol: 'NVDA', position: 0 }), stock({ id: 's2', symbol: 'AAPL', position: 1 })];
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail(stocks));
    vi.mocked(reorderStocks).mockRejectedValueOnce(new ApiError(400, 'reorder failed'));

    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: 'Simulate reorder' }));

    expect(await screen.findByText('reorder failed')).toBeInTheDocument();
    const symbols = screen.getAllByText(/^(NVDA|AAPL)$/).map((el) => el.textContent);
    expect(symbols).toEqual(['NVDA', 'AAPL']);
  });
});
