import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from './DashboardPage';
import { mockUser, renderWithProviders } from '../test/testUtils';
import type { ChangeEventSummary, MarketSignalSummary, WatchlistMarketStateResult } from '../types/marketState';
import type { QuoteResponse } from '../types/marketData';
import type { WatchlistDetail, WatchlistStock, WatchlistSummary } from '../types/watchlist';

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
import { ApiError } from '../api/client';
import { getQuote } from '../api/marketData';
import { getWatchlist, getWatchlists, recordWatchlistSeen } from '../api/watchlists';

const watchlist = (overrides: Partial<WatchlistSummary> = {}): WatchlistSummary => ({
  id: 'w1',
  name: 'Technology',
  stock_count: 3,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const stock = (overrides: Partial<WatchlistStock> = {}): WatchlistStock => ({
  id: 's1',
  symbol: 'NVDA',
  company_name: 'NVIDIA Corporation',
  exchange: 'NASDAQ',
  position: 0,
  ...overrides,
});

function detail(overrides: Partial<WatchlistDetail> = {}): WatchlistDetail {
  return {
    id: 'w1',
    name: 'Technology',
    stocks: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function quote(overrides: Partial<QuoteResponse> = {}): QuoteResponse {
  return {
    symbol: 'NVDA',
    price: '1322.00',
    previous_close: '1300.00',
    day_high: '1330.00',
    day_low: '1310.00',
    volume: 1_000_000,
    average_volume: 900_000,
    change: '22.00',
    change_percent: '1.69',
    timestamp: '2026-01-05T10:00:00Z',
    data_source: 'Yahoo Finance',
    is_delayed: false,
    ...overrides,
  };
}

const change = (overrides: Partial<ChangeEventSummary> = {}): ChangeEventSummary => ({
  stock_id: 's1',
  symbol: 'NVDA',
  type: 'PRICE_CHANGE',
  severity: 'MEDIUM',
  title: 'NVDA moved 4.0% since you last checked',
  description: 'NVDA increased from $1,270.00 to $1,322.00 since your last check.',
  old_value: '1270.00',
  new_value: '1322.00',
  detected_at: '2026-01-05T10:00:00Z',
  ...overrides,
});

const marketSignal = (overrides: Partial<MarketSignalSummary> = {}): MarketSignalSummary => ({
  stock_id: 's1',
  symbol: 'TATATECH',
  type: 'NEAR_DAY_LOW',
  severity: 'MEDIUM',
  title: 'TATATECH is near today’s low',
  description: 'TATATECH is trading at ₹800.00, close to today\'s low of ₹796.10.',
  detected_at: '2026-01-05T10:00:00Z',
  ...overrides,
});

function seenResult(overrides: Partial<WatchlistMarketStateResult> = {}): WatchlistMarketStateResult {
  return {
    watchlist_id: 'w1',
    processed: 1,
    successful: 1,
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
  vi.mocked(getWatchlists).mockReset();
  vi.mocked(recordWatchlistSeen).mockReset();
  vi.mocked(recordWatchlistSeen).mockResolvedValue(seenResult());
  vi.mocked(getWatchlist).mockReset();
  vi.mocked(getWatchlist).mockResolvedValue(detail());
  vi.mocked(getQuote).mockReset();
  vi.mocked(getQuote).mockResolvedValue(quote());
});

function renderDashboard() {
  return renderWithProviders(
    <Routes>
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/watchlists/:watchlistId" element={<div>Watchlist detail page</div>} />
      <Route path="/changes" element={<div>Changes page</div>} />
    </Routes>,
    { route: '/dashboard' },
  );
}

describe('DashboardPage', () => {
  it('loads for an authenticated user and shows a personalized greeting', async () => {
    vi.mocked(getWatchlists).mockResolvedValueOnce([watchlist()]);

    renderDashboard();

    expect(await screen.findByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText('Here’s what changed since you last checked.')).toBeInTheDocument();
  });

  it('shows a skeleton before data arrives, never a premature "0" summary', async () => {
    let resolveWatchlists!: (value: WatchlistSummary[]) => void;
    vi.mocked(getWatchlists).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveWatchlists = resolve;
      }),
    );

    renderDashboard();

    expect(await screen.findByText(/Alice/)).toBeInTheDocument();
    expect(screen.queryByText('Stocks')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();

    resolveWatchlists([watchlist()]);

    expect(await screen.findByText('3')).toBeInTheDocument();
  });

  it('shows the correct total stock count across watchlists', async () => {
    vi.mocked(getWatchlists).mockResolvedValueOnce([
      watchlist({ id: 'w1', stock_count: 3 }),
      watchlist({ id: 'w2', name: 'Growth', stock_count: 5 }),
    ]);

    renderDashboard();

    expect(await screen.findByText('8')).toBeInTheDocument();
    expect(screen.getByText('Stocks')).toBeInTheDocument();
  });

  it('shows the correct meaningful-change count and HIGH-impact count', async () => {
    vi.mocked(getWatchlists).mockResolvedValueOnce([watchlist({ id: 'w1', stock_count: 9 })]);
    vi.mocked(recordWatchlistSeen).mockResolvedValueOnce(
      seenResult({
        detected: 2,
        changes: [
          change({ stock_id: 's1', symbol: 'NVDA', severity: 'HIGH' }),
          change({ stock_id: 's2', symbol: 'AAPL', severity: 'MEDIUM' }),
        ],
      }),
    );

    renderDashboard();

    expect(await screen.findByText('2')).toBeInTheDocument();
    expect(screen.getByText('Meaningful Changes')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('High Impact')).toBeInTheDocument();
  });

  it('links "View all changes" to the Changes page when there are changes', async () => {
    vi.mocked(getWatchlists).mockResolvedValueOnce([watchlist({ id: 'w1', stock_count: 2 })]);
    vi.mocked(recordWatchlistSeen).mockResolvedValueOnce(
      seenResult({ detected: 1, changes: [change()] }),
    );

    renderDashboard();

    await userEvent.click(await screen.findByRole('link', { name: 'View all changes →' }));

    expect(await screen.findByText('Changes page')).toBeInTheDocument();
  });

  it('does not show "View all changes" when there are no changes', async () => {
    vi.mocked(getWatchlists).mockResolvedValueOnce([watchlist({ id: 'w1', stock_count: 2 })]);
    vi.mocked(recordWatchlistSeen).mockResolvedValueOnce(seenResult({ detected: 0, changes: [] }));

    renderDashboard();

    await screen.findByText('You’re all caught up.');
    expect(screen.queryByRole('link', { name: 'View all changes →' })).not.toBeInTheDocument();
  });

  it('orders HIGH severity changes before MEDIUM in the attention list', async () => {
    vi.mocked(getWatchlists).mockResolvedValueOnce([watchlist({ id: 'w1', stock_count: 2 })]);
    vi.mocked(recordWatchlistSeen).mockResolvedValueOnce(
      seenResult({
        detected: 2,
        changes: [
          change({ stock_id: 's1', symbol: 'AAPL', severity: 'MEDIUM', title: 'AAPL moved 4.0% since you last checked' }),
          change({ stock_id: 's2', symbol: 'NVDA', severity: 'HIGH', title: 'NVDA moved 12.0% since you last checked' }),
        ],
      }),
    );

    renderDashboard();

    await screen.findByText('NVDA moved 12.0% since you last checked');
    const items = screen.getAllByRole('listitem');
    const texts = items.map((item) => item.textContent ?? '');
    const highIndex = texts.findIndex((t) => t.includes('NVDA moved 12.0%'));
    const mediumIndex = texts.findIndex((t) => t.includes('AAPL moved 4.0%'));
    expect(highIndex).toBeLessThan(mediumIndex);
  });

  it('uses the backend title and description verbatim, without recalculating', async () => {
    vi.mocked(getWatchlists).mockResolvedValueOnce([watchlist({ id: 'w1', stock_count: 1 })]);
    vi.mocked(recordWatchlistSeen).mockResolvedValueOnce(
      seenResult({
        detected: 1,
        changes: [
          change({
            title: 'NVDA volume is 70% above average',
            description: 'Trading volume increased from an average of 10.0M shares to 17.0M shares.',
            type: 'VOLUME_SPIKE',
          }),
        ],
      }),
    );

    renderDashboard();

    expect(await screen.findByText('NVDA volume is 70% above average')).toBeInTheDocument();
    expect(
      screen.getByText('Trading volume increased from an average of 10.0M shares to 17.0M shares.'),
    ).toBeInTheDocument();
  });

  it('shows a calm "all caught up" state when there are no meaningful changes', async () => {
    vi.mocked(getWatchlists).mockResolvedValueOnce([watchlist({ id: 'w1', stock_count: 2 })]);
    vi.mocked(recordWatchlistSeen).mockResolvedValueOnce(seenResult({ detected: 0, changes: [] }));

    renderDashboard();

    expect(await screen.findByText('You’re all caught up.')).toBeInTheDocument();
    expect(screen.getByText('No meaningful changes since your last check.')).toBeInTheDocument();
    expect(screen.getByText('No Meaningful Changes')).toBeInTheDocument();
  });

  it('shows correct stock/change counts on each watchlist card', async () => {
    vi.mocked(getWatchlists).mockResolvedValueOnce([
      watchlist({ id: 'w1', name: 'Tech', stock_count: 3 }),
      watchlist({ id: 'w2', name: 'Long Term', stock_count: 10 }),
    ]);
    vi.mocked(recordWatchlistSeen).mockImplementation(async (id: string) =>
      id === 'w1'
        ? seenResult({ watchlist_id: 'w1', detected: 2, changes: [change(), change({ stock_id: 's2' })] })
        : seenResult({ watchlist_id: 'w2', detected: 0, changes: [] }),
    );

    renderDashboard();

    expect(await screen.findByText('Tech')).toBeInTheDocument();
    expect(screen.getByText('3 stocks')).toBeInTheDocument();
    expect(screen.getByText('2 changes')).toBeInTheDocument();

    expect(screen.getByText('Long Term')).toBeInTheDocument();
    expect(screen.getByText('10 stocks')).toBeInTheDocument();
    expect(screen.getByText('No major changes')).toBeInTheDocument();
  });

  it('navigates to the existing watchlist detail page when a watchlist card is clicked', async () => {
    vi.mocked(getWatchlists).mockResolvedValueOnce([watchlist({ id: 'w1', name: 'Tech', stock_count: 3 })]);

    renderDashboard();

    await userEvent.click(await screen.findByText('Tech'));

    expect(await screen.findByText('Watchlist detail page')).toBeInTheDocument();
  });

  it('shows the empty-watchlists state when the user has no watchlists at all', async () => {
    vi.mocked(getWatchlists).mockResolvedValueOnce([]);

    renderDashboard();

    expect(await screen.findByText('Build your first watchlist')).toBeInTheDocument();
    expect(recordWatchlistSeen).not.toHaveBeenCalled();
  });

  it('skips the seen call for watchlists with no stocks', async () => {
    vi.mocked(getWatchlists).mockResolvedValueOnce([
      watchlist({ id: 'w1', name: 'Has stocks', stock_count: 2 }),
      watchlist({ id: 'w2', name: 'Empty one', stock_count: 0 }),
    ]);

    renderDashboard();

    await screen.findByText('Has stocks');
    await waitFor(() => expect(recordWatchlistSeen).toHaveBeenCalledTimes(1));
    expect(recordWatchlistSeen).toHaveBeenCalledWith('w1');
  });

  it('isolates one watchlist\'s failed seen call from the others', async () => {
    vi.mocked(getWatchlists).mockResolvedValueOnce([
      watchlist({ id: 'w1', name: 'Working', stock_count: 2 }),
      watchlist({ id: 'w2', name: 'Broken', stock_count: 2 }),
    ]);
    vi.mocked(recordWatchlistSeen).mockImplementation(async (id: string) => {
      if (id === 'w2') throw new ApiError(503, 'unavailable');
      return seenResult({ watchlist_id: 'w1', detected: 1, changes: [change()] });
    });

    renderDashboard();

    expect(await screen.findByText('Working')).toBeInTheDocument();
    expect(screen.getByText('Broken')).toBeInTheDocument();
    expect(screen.getByText('1 change')).toBeInTheDocument();
    // The broken watchlist just shows no changes -- never fabricated, never
    // crashes the rest of the page.
    expect(screen.getByText('No major changes')).toBeInTheDocument();
  });

  it('shows an error state with retry when the watchlist list itself fails to load', async () => {
    vi.mocked(getWatchlists).mockRejectedValueOnce(new ApiError(500, 'server error'));

    renderDashboard();

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();

    vi.mocked(getWatchlists).mockResolvedValueOnce([watchlist({ stock_count: 4 })]);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('4')).toBeInTheDocument();
  });

  describe('Market Activity', () => {
    it('shows current price and movement for stocks, distinct from meaningful changes', async () => {
      vi.mocked(getWatchlists).mockResolvedValueOnce([watchlist({ id: 'w1', stock_count: 1 })]);
      vi.mocked(getWatchlist).mockResolvedValueOnce(detail({ id: 'w1', stocks: [stock({ symbol: 'NVDA' })] }));
      vi.mocked(getQuote).mockResolvedValueOnce(
        quote({ symbol: 'NVDA', price: '1322.00', change_percent: '1.69' }),
      );

      renderDashboard();

      expect(await screen.findByText('Market Activity')).toBeInTheDocument();
      expect(screen.getByText('₹1,322.00')).toBeInTheDocument();
      expect(screen.getByText('+1.69%')).toBeInTheDocument();
      // Never a severity badge here -- that would make it indistinguishable
      // from a real meaningful change.
      expect(screen.queryByText('HIGH')).not.toBeInTheDocument();
      expect(screen.queryByText('MEDIUM')).not.toBeInTheDocument();
    });

    it('shows the price without a percentage when previous close is unavailable', async () => {
      vi.mocked(getWatchlists).mockResolvedValueOnce([watchlist({ id: 'w1', stock_count: 1 })]);
      vi.mocked(getWatchlist).mockResolvedValueOnce(detail({ id: 'w1', stocks: [stock({ symbol: 'NVDA' })] }));
      vi.mocked(getQuote).mockResolvedValueOnce(
        quote({ symbol: 'NVDA', price: '1322.00', change_percent: null, previous_close: null }),
      );

      renderDashboard();

      expect(await screen.findByText('₹1,322.00')).toBeInTheDocument();
      expect(screen.queryByText('%', { exact: false })).not.toBeInTheDocument();
    });

    it('deduplicates a stock that appears in more than one watchlist', async () => {
      vi.mocked(getWatchlists).mockResolvedValueOnce([
        watchlist({ id: 'w1', name: 'Tech', stock_count: 1 }),
        watchlist({ id: 'w2', name: 'Long Term', stock_count: 1 }),
      ]);
      vi.mocked(getWatchlist).mockImplementation(async (id: string) =>
        detail({ id, stocks: [stock({ id: 's1', symbol: 'NVDA' })] }),
      );
      vi.mocked(getQuote).mockResolvedValue(quote({ symbol: 'NVDA' }));

      renderDashboard();

      await screen.findByText('Market Activity');
      expect(getQuote).toHaveBeenCalledTimes(1);
      expect(screen.getAllByText('NVDA').length).toBe(1);
    });

    it('skips a stock whose quote failed without breaking the rest', async () => {
      vi.mocked(getWatchlists).mockResolvedValueOnce([watchlist({ id: 'w1', stock_count: 2 })]);
      vi.mocked(getWatchlist).mockResolvedValueOnce(
        detail({
          id: 'w1',
          stocks: [stock({ id: 's1', symbol: 'NVDA' }), stock({ id: 's2', symbol: 'AAPL' })],
        }),
      );
      vi.mocked(getQuote).mockImplementation(async (symbol: string) => {
        if (symbol === 'AAPL') throw new ApiError(503, 'unavailable');
        return quote({ symbol: 'NVDA' });
      });

      renderDashboard();

      expect(await screen.findByText('Market Activity')).toBeInTheDocument();
      expect(screen.getByText('NVDA')).toBeInTheDocument();
      expect(screen.queryByText('AAPL')).not.toBeInTheDocument();
    });

    it('caps Market Activity at 8 stocks across watchlists', async () => {
      const stocks = Array.from({ length: 12 }, (_, i) => stock({ id: `s${i}`, symbol: `SYM${i}` }));
      vi.mocked(getWatchlists).mockResolvedValueOnce([watchlist({ id: 'w1', stock_count: 12 })]);
      vi.mocked(getWatchlist).mockResolvedValueOnce(detail({ id: 'w1', stocks }));
      vi.mocked(getQuote).mockImplementation(async (symbol: string) => quote({ symbol }));

      renderDashboard();

      await screen.findByText('Market Activity');
      expect(getQuote).toHaveBeenCalledTimes(8);
    });

    it('does not fetch quotes or show Market Activity when there are no watchlists', async () => {
      vi.mocked(getWatchlists).mockResolvedValueOnce([]);

      renderDashboard();

      expect(await screen.findByText('Build your first watchlist')).toBeInTheDocument();
      expect(getWatchlist).not.toHaveBeenCalled();
      expect(getQuote).not.toHaveBeenCalled();
    });
  });

  describe('Market Signals (Phase 6C)', () => {
    it('shows a Market Signals section when the response has none but market_signals exist (CASE B)', async () => {
      vi.mocked(getWatchlists).mockResolvedValueOnce([watchlist({ id: 'w1', stock_count: 3 })]);
      vi.mocked(recordWatchlistSeen).mockResolvedValueOnce(
        seenResult({ detected: 0, changes: [], market_signals: [marketSignal()] }),
      );

      renderDashboard();

      expect(await screen.findByText('You’re all caught up.')).toBeInTheDocument();
      expect(screen.getByText('Market Signals')).toBeInTheDocument();
      expect(screen.getByText('TATATECH is near today’s low')).toBeInTheDocument();
    });

    it('shows both Needs your attention and Market Signals together (CASE A)', async () => {
      vi.mocked(getWatchlists).mockResolvedValueOnce([watchlist({ id: 'w1', stock_count: 3 })]);
      vi.mocked(recordWatchlistSeen).mockResolvedValueOnce(
        seenResult({
          detected: 1,
          changes: [change({ symbol: 'NVDA' })],
          market_signals: [marketSignal({ symbol: 'WIPRO', title: 'WIPRO is near today’s low' })],
        }),
      );

      renderDashboard();

      expect(await screen.findByText('NVDA moved 4.0% since you last checked')).toBeInTheDocument();
      expect(screen.getByText('WIPRO is near today’s low')).toBeInTheDocument();
    });

    it('shows neither section when there are no changes and no market_signals (CASE C)', async () => {
      vi.mocked(getWatchlists).mockResolvedValueOnce([watchlist({ id: 'w1', stock_count: 3 })]);
      vi.mocked(recordWatchlistSeen).mockResolvedValueOnce(
        seenResult({ detected: 0, changes: [], market_signals: [] }),
      );

      renderDashboard();

      expect(await screen.findByText('You’re all caught up.')).toBeInTheDocument();
      expect(screen.queryByText('Market Signals')).not.toBeInTheDocument();
    });

    it('never counts market_signals toward the Meaningful Changes / High Impact summary tiles', async () => {
      vi.mocked(getWatchlists).mockResolvedValueOnce([watchlist({ id: 'w1', stock_count: 3 })]);
      vi.mocked(recordWatchlistSeen).mockResolvedValueOnce(
        seenResult({
          detected: 0,
          changes: [],
          market_signals: [marketSignal(), marketSignal({ stock_id: 's2', symbol: 'WIPRO' })],
        }),
      );

      renderDashboard();

      expect(await screen.findByText('Market Signals')).toBeInTheDocument();
      // The summary row still reflects zero personalized changes.
      expect(screen.getByText('No Meaningful Changes')).toBeInTheDocument();
      expect(screen.queryByText('Meaningful Changes')).not.toBeInTheDocument();
      expect(screen.queryByText('High Impact')).not.toBeInTheDocument();
    });

    it('clicking a Market Signal card navigates to the stock detail page', async () => {
      vi.mocked(getWatchlists).mockResolvedValueOnce([watchlist({ id: 'w1', stock_count: 3 })]);
      vi.mocked(recordWatchlistSeen).mockResolvedValueOnce(
        seenResult({ detected: 0, changes: [], market_signals: [marketSignal()] }),
      );

      renderWithProviders(
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/stocks/:symbol" element={<div>Stock detail page</div>} />
        </Routes>,
        { route: '/dashboard' },
      );

      await userEvent.click(await screen.findByText('TATATECH is near today’s low'));

      expect(await screen.findByText('Stock detail page')).toBeInTheDocument();
    });
  });
});
