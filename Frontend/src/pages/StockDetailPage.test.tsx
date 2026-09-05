import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StockDetailPage } from './StockDetailPage';
import { mockUser, renderWithProviders } from '../test/testUtils';
import { ApiError } from '../api/client';
import type { HistoricalResponse, QuoteResponse } from '../types/marketData';
import type { ChangeEventSummary, WatchlistMarketStateResult } from '../types/marketState';
import type { WatchlistDetail } from '../types/watchlist';

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
  recordWatchlistSeen: vi.fn(),
}));

vi.mock('../api/marketData', () => ({
  searchStocks: vi.fn(),
  getQuote: vi.fn(),
  getHistory: vi.fn(),
}));

import { meRequest } from '../api/auth';
import { getHistory, getQuote } from '../api/marketData';
import { getWatchlist, getWatchlists, recordWatchlistSeen } from '../api/watchlists';

const quote = (overrides: Partial<QuoteResponse> = {}): QuoteResponse => ({
  symbol: 'RELIANCE',
  price: '2970.00',
  previous_close: '2850.00',
  day_high: '2990.00',
  day_low: '2930.00',
  volume: 5000000,
  average_volume: 4800000,
  change: '120.00',
  change_percent: '4.21',
  timestamp: '2026-01-05T10:00:00Z',
  data_source: 'Yahoo Finance',
  is_delayed: false,
  ...overrides,
});

const history = (overrides: Partial<HistoricalResponse> = {}): HistoricalResponse => ({
  symbol: 'RELIANCE',
  period: '1M',
  data_source: 'Yahoo Finance',
  candles: [
    { timestamp: '2026-01-01T10:00:00Z', open: '2800', high: '2820', low: '2790', close: '2810', volume: 100000 },
    { timestamp: '2026-01-02T10:00:00Z', open: '2810', high: '2900', low: '2805', close: '2890', volume: 120000 },
    { timestamp: '2026-01-03T10:00:00Z', open: '2890', high: '2980', low: '2880', close: '2970', volume: 130000 },
  ],
  ...overrides,
});

const detail = (overrides: Partial<WatchlistDetail> = {}): WatchlistDetail => ({
  id: 'w1',
  name: 'Energy',
  stocks: [
    { id: 's1', symbol: 'RELIANCE', company_name: 'Reliance Industries Ltd.', exchange: 'NSE', position: 0 },
    { id: 's2', symbol: 'ONGC', company_name: 'Oil and Natural Gas Corp', exchange: 'NSE', position: 1 },
  ],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

function change(overrides: Partial<ChangeEventSummary> = {}): ChangeEventSummary {
  return {
    stock_id: 's1',
    symbol: 'RELIANCE',
    type: 'PRICE_CHANGE',
    severity: 'HIGH',
    title: 'RELIANCE moved 10.0% since you last checked',
    description: 'RELIANCE increased from ₹2,850.00 to ₹3,135.00.',
    old_value: '2850.00',
    new_value: '3135.00',
    detected_at: '2026-01-05T10:00:00Z',
    ...overrides,
  };
}

function seenResult(overrides: Partial<WatchlistMarketStateResult> = {}): WatchlistMarketStateResult {
  return {
    watchlist_id: 'w1',
    processed: 2,
    successful: 2,
    failed: 0,
    failed_symbols: [],
    seen_at: '2026-01-05T10:00:05Z',
    detected: 0,
    changes: [],
    market_signals: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(meRequest).mockResolvedValue(mockUser);
  vi.mocked(getQuote).mockReset();
  vi.mocked(getQuote).mockResolvedValue(quote());
  vi.mocked(getHistory).mockReset();
  vi.mocked(getHistory).mockResolvedValue(history());
  vi.mocked(getWatchlist).mockReset();
  vi.mocked(getWatchlist).mockResolvedValue(detail());
  vi.mocked(getWatchlists).mockReset();
  vi.mocked(getWatchlists).mockResolvedValue([
    { id: 'w1', name: 'Energy', stock_count: 2, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
  ]);
  vi.mocked(recordWatchlistSeen).mockReset();
  vi.mocked(recordWatchlistSeen).mockResolvedValue(seenResult());
});

function renderPage(route: string | { pathname: string; state?: unknown }) {
  return renderWithProviders(
    <Routes>
      <Route path="/stocks/:symbol" element={<StockDetailPage />} />
      <Route path="/watchlists/:watchlistId" element={<div>Watchlist detail page</div>} />
      <Route path="/watchlists" element={<div>Watchlists page</div>} />
    </Routes>,
    { route },
  );
}

describe('StockDetailPage', () => {
  it('loads and shows the real quote with current market movement', async () => {
    renderPage({ pathname: '/stocks/RELIANCE', state: { watchlistId: 'w1', changes: [] } });

    expect(await screen.findByText('RELIANCE')).toBeInTheDocument();
    expect(screen.getByText('₹2,970.00')).toBeInTheDocument();
    expect(screen.getByText(/\+4\.21%/)).toBeInTheDocument();
  });

  it('shows a meaningful ChangeEvent, distinct from today\'s market movement', async () => {
    renderPage({
      pathname: '/stocks/RELIANCE',
      state: { watchlistId: 'w1', changes: [change()] },
    });

    expect(await screen.findByText('Since you last checked')).toBeInTheDocument();
    expect(screen.getByText('RELIANCE moved 10.0% since you last checked')).toBeInTheDocument();
    expect(screen.getByText('RELIANCE increased from ₹2,850.00 to ₹3,135.00.')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    // Never calls recordWatchlistSeen again -- the change came from nav state.
    expect(recordWatchlistSeen).not.toHaveBeenCalled();
  });

  it('renders multiple changes for this stock in priority order', async () => {
    renderPage({
      pathname: '/stocks/RELIANCE',
      state: {
        watchlistId: 'w1',
        changes: [
          change({ severity: 'MEDIUM', title: 'RELIANCE moved 4.0% since you last checked', detected_at: '2026-01-05T09:00:00Z' }),
          change({ severity: 'HIGH', title: 'RELIANCE moved 12.0% since you last checked', detected_at: '2026-01-05T11:00:00Z' }),
        ],
      },
    });

    await screen.findByText('RELIANCE moved 12.0% since you last checked');
    const items = screen.getAllByRole('listitem');
    const texts = items.map((item) => item.textContent ?? '');
    const highIndex = texts.findIndex((t) => t.includes('12.0%'));
    const mediumIndex = texts.findIndex((t) => t.includes('4.0%'));
    expect(highIndex).toBeLessThan(mediumIndex);
  });

  it('shows nothing extra when there are no meaningful changes for this stock', async () => {
    renderPage({
      pathname: '/stocks/RELIANCE',
      state: { watchlistId: 'w1', changes: [change({ symbol: 'ONGC' })] },
    });

    await screen.findByText('RELIANCE');
    expect(screen.queryByText('Since you last checked')).not.toBeInTheDocument();
  });

  it('loads real chart history on the Chart tab and switches timeframe', async () => {
    renderPage({ pathname: '/stocks/RELIANCE', state: { watchlistId: 'w1', changes: [] } });
    await screen.findByText('RELIANCE');

    await userEvent.click(screen.getByRole('tab', { name: 'Chart' }));
    await waitFor(() => expect(getHistory).toHaveBeenCalledWith('RELIANCE', '1M'));

    await userEvent.click(screen.getByRole('button', { name: '1Y' }));
    await waitFor(() => expect(getHistory).toHaveBeenCalledWith('RELIANCE', '1Y'));
  });

  it('shows a clear not-found state for an invalid symbol', async () => {
    vi.mocked(getQuote).mockRejectedValueOnce(new ApiError(404, 'Unknown symbol: FAKESYM'));

    renderPage({ pathname: '/stocks/FAKESYM', state: { watchlistId: 'w1', changes: [] } });

    expect(await screen.findByText('Stock not found')).toBeInTheDocument();
  });

  it('navigates to another stock when a sidebar item is clicked', async () => {
    renderPage({ pathname: '/stocks/RELIANCE', state: { watchlistId: 'w1', changes: [] } });
    await screen.findByText('RELIANCE');

    const sidebarLinks = await screen.findAllByRole('link', { name: /ONGC/ });
    await userEvent.click(sidebarLinks[0]);

    await waitFor(() => {
      const links = screen.getAllByRole('link', { name: /ONGC/ });
      expect(links.some((link) => link.getAttribute('aria-current') === 'page')).toBe(true);
    });
    expect(screen.getAllByText('ONGC').length).toBeGreaterThan(1);
  });

  it('back link returns to the originating watchlist', async () => {
    renderPage({ pathname: '/stocks/RELIANCE', state: { watchlistId: 'w1', changes: [] } });
    await screen.findByText('RELIANCE');

    await userEvent.click(screen.getByRole('link', { name: /Back to Watchlist/ }));
    expect(await screen.findByText('Watchlist detail page')).toBeInTheDocument();
  });

  it('falls back to recording the watchlist as seen once, only on a direct visit without nav state', async () => {
    renderPage('/stocks/RELIANCE');

    await screen.findByText('RELIANCE');
    await waitFor(() => expect(recordWatchlistSeen).toHaveBeenCalledTimes(1));
    expect(recordWatchlistSeen).toHaveBeenCalledWith('w1');
  });

  describe('Insights -- Past Week summary', () => {
    it('shows a real past-week summary even when there are no meaningful changes', async () => {
      renderPage({ pathname: '/stocks/RELIANCE', state: { watchlistId: 'w1', changes: [] } });
      await screen.findByText('₹2,970.00');

      await userEvent.click(screen.getByRole('tab', { name: 'Insights' }));

      expect(await screen.findByText('Nothing meaningful detected for RELIANCE yet.')).toBeInTheDocument();
      expect(await screen.findByText('Past Week')).toBeInTheDocument();
      // From the default history() fixture: open 2800 -> close 2970.
      expect(screen.getByText('+6.07%')).toBeInTheDocument();
      expect(screen.getByText('₹2,980.00')).toBeInTheDocument(); // week high
      expect(screen.getByText('₹2,790.00')).toBeInTheDocument(); // week low
      expect(screen.getByText('1.17L')).toBeInTheDocument(); // average volume
      expect(getHistory).toHaveBeenCalledWith('RELIANCE', '1W');
    });

    it('shows both the meaningful change and the past-week summary together', async () => {
      renderPage({
        pathname: '/stocks/RELIANCE',
        state: { watchlistId: 'w1', changes: [change()] },
      });
      await screen.findByText('₹2,970.00');

      await userEvent.click(screen.getByRole('tab', { name: 'Insights' }));

      expect(await screen.findByText('RELIANCE moved 10.0% since you last checked')).toBeInTheDocument();
      expect(await screen.findByText('Past Week')).toBeInTheDocument();
    });

    it('does not show a past-week summary when history is unavailable, without crashing', async () => {
      // Only the Insights tab's own "1W" request fails -- the Chart tab's
      // separate, eagerly-fetched period is unaffected either way.
      vi.mocked(getHistory).mockImplementation(async (sym: string, period) => {
        if (period === '1W') throw new ApiError(503, 'unavailable');
        return history({ symbol: sym, period });
      });
      renderPage({ pathname: '/stocks/RELIANCE', state: { watchlistId: 'w1', changes: [] } });
      await screen.findByText('₹2,970.00');

      await userEvent.click(screen.getByRole('tab', { name: 'Insights' }));

      expect(await screen.findByText('Nothing meaningful detected for RELIANCE yet.')).toBeInTheDocument();
      expect(screen.queryByText('Past Week')).not.toBeInTheDocument();
    });

    it('is independent of the Chart tab\'s own selected timeframe', async () => {
      renderPage({ pathname: '/stocks/RELIANCE', state: { watchlistId: 'w1', changes: [] } });
      await screen.findByText('₹2,970.00');

      await userEvent.click(screen.getByRole('tab', { name: 'Chart' }));
      await userEvent.click(screen.getByRole('button', { name: '1Y' }));
      await waitFor(() => expect(getHistory).toHaveBeenCalledWith('RELIANCE', '1Y'));

      await userEvent.click(screen.getByRole('tab', { name: 'Insights' }));

      expect(await screen.findByText('Past Week')).toBeInTheDocument();
      expect(getHistory).toHaveBeenCalledWith('RELIANCE', '1W');
    });
  });
});
