import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { WatchlistDetailPage } from './WatchlistDetailPage';
import { mockUser, renderWithProviders } from '../test/testUtils';
import type { QuoteResponse, QuoteState, StockSearchResult } from '../types/marketData';
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
  recordWatchlistSeen: vi.fn(),
}));

vi.mock('../api/marketData', () => ({
  searchStocks: vi.fn(),
  getQuote: vi.fn(),
  getHistory: vi.fn(),
}));

// StockList's real drag mechanics rely on dnd-kit's pointer geometry, which
// jsdom does not lay out -- so for reorder tests we swap in a stand-in that
// exposes the same onReorder contract via a plain button, letting us test
// WatchlistDetailPage's own optimistic-update/rollback/quote-fetch logic
// directly. The real per-stock price/change formatting is covered by
// StockRow.test.tsx; this stand-in only surfaces enough of the `quotes` prop
// to prove WatchlistDetailPage wires fetch state through correctly. dnd-kit
// itself is a mature, separately-tested library.
vi.mock('../components/watchlists/StockList', () => ({
  StockList: ({
    stocks,
    quotes,
    onReorder,
    onRemove,
  }: {
    stocks: WatchlistStock[];
    quotes: Record<string, QuoteState>;
    onReorder: (next: WatchlistStock[]) => void;
    onRemove: (symbol: string) => void;
  }): ReactNode => (
    <div>
      {stocks.map((s) => {
        const q = quotes[s.symbol];
        return (
          <div key={s.id}>
            <span>{s.symbol}</span>
            {q?.status === 'loading' && <span>{`quote-loading:${s.symbol}`}</span>}
            {q?.status === 'error' && <span>{`quote-error:${s.symbol}:${q.message}`}</span>}
            {q?.status === 'success' && (
              <span>{`quote-price:${s.symbol}:${q.data.price}:${q.data.is_delayed ? 'delayed' : 'live'}`}</span>
            )}
            <button onClick={() => onRemove(s.symbol)}>Remove {s.symbol}</button>
          </div>
        );
      })}
      <button onClick={() => onReorder([...stocks].reverse())}>Simulate reorder</button>
    </div>
  ),
}));

import { meRequest } from '../api/auth';
import { ApiError } from '../api/client';
import { getQuote, searchStocks } from '../api/marketData';
import {
  addStock,
  deleteWatchlist,
  getWatchlist,
  recordWatchlistSeen,
  removeStock,
  renameWatchlist,
  reorderStocks,
} from '../api/watchlists';
import type { ChangeEventSummary, WatchlistMarketStateResult } from '../types/marketState';

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

const searchResult = (overrides: Partial<StockSearchResult> = {}): StockSearchResult => ({
  symbol: 'AAPL',
  company_name: 'Apple Inc.',
  exchange: 'NASDAQ',
  instrument_key: 'AAPL',
  ...overrides,
});

const quote = (overrides: Partial<QuoteResponse> = {}): QuoteResponse => ({
  symbol: 'NVDA',
  price: '1322.0',
  previous_close: '1302.5',
  day_high: '1333.0',
  day_low: '1304.10',
  volume: 13022095,
  average_volume: 12537650,
  change: '19.5',
  change_percent: '1.5',
  timestamp: '2026-01-05T10:00:00Z',
  data_source: 'Yahoo Finance',
  is_delayed: false,
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

function change(overrides: Partial<ChangeEventSummary> = {}): ChangeEventSummary {
  return {
    stock_id: 's1',
    symbol: 'NVDA',
    type: 'PRICE_CHANGE',
    severity: 'MEDIUM',
    title: 'NVDA moved 4.0% since you last checked',
    description: 'NVDA increased from $1,270.00 to $1,322.00 since your last check.',
    old_value: '1270.00',
    new_value: '1322.00',
    detected_at: '2026-01-05T10:00:05Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(meRequest).mockResolvedValue(mockUser);
  vi.mocked(searchStocks).mockReset();
  vi.mocked(searchStocks).mockResolvedValue([]);
  vi.mocked(getQuote).mockReset();
  vi.mocked(getQuote).mockRejectedValue(new ApiError(503, 'Market data unavailable'));
  vi.mocked(recordWatchlistSeen).mockReset();
  vi.mocked(recordWatchlistSeen).mockResolvedValue(seenResult());
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

// ---------------------------------------------------------------------------
// Add Stock: real search-based flow (Phase 4B)
// ---------------------------------------------------------------------------

describe('Add Stock search flow', () => {
  it('does not search for a single-character query', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail([]));

    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: /Add Stock/i }));
    await userEvent.type(screen.getByLabelText('Search'), 'r');

    expect(await screen.findByText('Keep typing to search…')).toBeInTheDocument();
    expect(searchStocks).not.toHaveBeenCalled();
  });

  it('debounces search input and calls search only once for a full query', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail([]));

    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: /Add Stock/i }));
    await userEvent.type(screen.getByLabelText('Search'), 'reliance');

    await waitFor(() => expect(searchStocks).toHaveBeenCalledTimes(1));
    expect(searchStocks).toHaveBeenCalledWith('reliance');
  });

  it('shows a loading state while the search request is in flight', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail([]));
    let resolveSearch!: (value: StockSearchResult[]) => void;
    vi.mocked(searchStocks).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSearch = resolve;
      }),
    );

    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: /Add Stock/i }));
    await userEvent.type(screen.getByLabelText('Search'), 'reliance');
    await waitFor(() => expect(searchStocks).toHaveBeenCalled());

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    resolveSearch([searchResult({ symbol: 'RELIANCE', company_name: 'Reliance Industries Limited', exchange: 'NSE' })]);

    expect(await screen.findByRole('listbox')).toBeInTheDocument();
  });

  it('shows a no-results message', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail([]));
    vi.mocked(searchStocks).mockResolvedValueOnce([]);

    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: /Add Stock/i }));
    await userEvent.type(screen.getByLabelText('Search'), 'zzzzz');

    expect(await screen.findByText(/No stocks found for/)).toBeInTheDocument();
  });

  it('shows a search error state', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail([]));
    vi.mocked(searchStocks).mockRejectedValueOnce(new ApiError(503, 'Market data is temporarily unavailable.'));

    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: /Add Stock/i }));
    await userEvent.type(screen.getByLabelText('Search'), 'reliance');

    expect(await screen.findByText('Market data is temporarily unavailable.')).toBeInTheDocument();
  });

  it('selects a search result and adds it to the watchlist', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail([]));
    vi.mocked(searchStocks).mockResolvedValueOnce([
      searchResult({ symbol: 'RELIANCE', company_name: 'Reliance Industries Limited', exchange: 'NSE', instrument_key: 'RELIANCE.NS' }),
    ]);
    vi.mocked(addStock).mockResolvedValueOnce(
      stock({ id: 's2', symbol: 'RELIANCE', company_name: 'Reliance Industries Limited', exchange: 'NSE' }),
    );

    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: /Add Stock/i }));
    await userEvent.type(screen.getByLabelText('Search'), 'reliance');
    await userEvent.click(await screen.findByRole('option', { name: /RELIANCE/ }));

    expect(addStock).toHaveBeenCalledWith('w1', 'RELIANCE');
    expect(await screen.findByText('RELIANCE added to Technology')).toBeInTheDocument();
  });

  it('shows an inline error when the selected stock is already in the watchlist', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail());
    vi.mocked(searchStocks).mockResolvedValueOnce([
      searchResult({ symbol: 'NVDA', company_name: 'NVIDIA Corporation', exchange: 'NASDAQ', instrument_key: 'NVDA' }),
    ]);
    vi.mocked(addStock).mockRejectedValueOnce(new ApiError(409, 'This stock is already in the watchlist'));

    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: /Add Stock/i }));
    await userEvent.type(screen.getByLabelText('Search'), 'nvidia');
    await userEvent.click(await screen.findByRole('option', { name: /NVDA/ }));

    expect(await screen.findByText('This stock is already in the watchlist.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Watchlist quotes (Phase 4B)
// ---------------------------------------------------------------------------

describe('Watchlist quotes', () => {
  it('shows the current quote for a stock after it loads', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail());
    vi.mocked(getQuote).mockResolvedValueOnce(quote());

    renderDetail();

    expect(await screen.findByText('quote-price:NVDA:1322.0:live')).toBeInTheDocument();
  });

  it('shows a loading state before the quote resolves', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail());
    let resolveQuote!: (value: QuoteResponse) => void;
    vi.mocked(getQuote).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveQuote = resolve;
      }),
    );

    renderDetail();

    expect(await screen.findByText('quote-loading:NVDA')).toBeInTheDocument();

    resolveQuote(quote());

    expect(await screen.findByText('quote-price:NVDA:1322.0:live')).toBeInTheDocument();
  });

  it('fetches quotes for multiple stocks concurrently and isolates one failure from the others', async () => {
    const stocks = [
      stock({ id: 's1', symbol: 'RELIANCE', position: 0 }),
      stock({ id: 's2', symbol: 'TCS', position: 1 }),
      stock({ id: 's3', symbol: 'INFY', position: 2 }),
    ];
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail(stocks));
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => {
      if (symbol === 'INFY') throw new ApiError(503, 'Market data is temporarily unavailable.');
      return quote({ symbol, price: symbol === 'RELIANCE' ? '1322.0' : '3900.0' });
    });

    renderDetail();

    expect(await screen.findByText('quote-price:RELIANCE:1322.0:live')).toBeInTheDocument();
    expect(await screen.findByText('quote-price:TCS:3900.0:live')).toBeInTheDocument();
    expect(await screen.findByText('quote-error:INFY:Unavailable')).toBeInTheDocument();
    // RELIANCE and TCS are still fully usable despite INFY's failure.
    expect(screen.getByText('RELIANCE')).toBeInTheDocument();
    expect(screen.getByText('TCS')).toBeInTheDocument();
    expect(screen.getByText('INFY')).toBeInTheDocument();
  });

  it('shows a rate-limited message for a 429', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail());
    vi.mocked(getQuote).mockRejectedValueOnce(new ApiError(429, 'slow down'));

    renderDetail();

    expect(await screen.findByText('quote-error:NVDA:Rate limited')).toBeInTheDocument();
  });

  it('marks a quote as delayed when the backend flags it', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail());
    vi.mocked(getQuote).mockResolvedValueOnce(quote({ is_delayed: true }));

    renderDetail();

    expect(await screen.findByText('quote-price:NVDA:1322.0:delayed')).toBeInTheDocument();
  });

  it('refetches quotes on refresh and ignores a second click while one is already in flight', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail());
    vi.mocked(getQuote).mockResolvedValueOnce(quote());

    renderDetail();
    expect(await screen.findByText('quote-price:NVDA:1322.0:live')).toBeInTheDocument();

    let resolveRefreshQuote!: (value: QuoteResponse) => void;
    vi.mocked(getQuote).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefreshQuote = resolve;
      }),
    );

    const refreshButton = screen.getByRole('button', { name: 'Refresh quotes' });
    await userEvent.click(refreshButton);
    expect(refreshButton).toBeDisabled();
    await userEvent.click(refreshButton); // ignored -- a refresh is already in flight

    resolveRefreshQuote(quote({ price: '1400.0' }));

    expect(await screen.findByText('quote-price:NVDA:1400.0:live')).toBeInTheDocument();
    // Initial load's call (1) + exactly one refresh call (1) == 2. A second,
    // concurrent refresh call would make this 3.
    expect(vi.mocked(getQuote).mock.calls.length).toBe(2);
  });

  it('adding a stock fetches only its own quote, not the whole watchlist again', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail([]));
    vi.mocked(searchStocks).mockResolvedValueOnce([
      searchResult({ symbol: 'RELIANCE', company_name: 'Reliance Industries Limited', exchange: 'NSE', instrument_key: 'RELIANCE.NS' }),
    ]);
    vi.mocked(addStock).mockResolvedValueOnce(
      stock({ id: 's2', symbol: 'RELIANCE', company_name: 'Reliance Industries Limited', exchange: 'NSE' }),
    );
    vi.mocked(getQuote).mockResolvedValue(quote({ symbol: 'RELIANCE', price: '1322.0' }));

    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: /Add Stock/i }));
    await userEvent.type(screen.getByLabelText('Search'), 'reliance');
    await userEvent.click(await screen.findByRole('option', { name: /RELIANCE/ }));

    expect(await screen.findByText('quote-price:RELIANCE:1322.0:live')).toBeInTheDocument();
    expect(getQuote).toHaveBeenCalledWith('RELIANCE');
    expect(getQuote).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Recording market state as seen (Phase 5B)
// ---------------------------------------------------------------------------

describe('Recording market state as seen', () => {
  it('records the watchlist as seen once the current quote has successfully loaded', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail());
    vi.mocked(getQuote).mockResolvedValueOnce(quote());

    renderDetail();

    expect(await screen.findByText('quote-price:NVDA:1322.0:live')).toBeInTheDocument();
    await waitFor(() => expect(recordWatchlistSeen).toHaveBeenCalledWith('w1'));
    expect(recordWatchlistSeen).toHaveBeenCalledTimes(1);
  });

  it('does not record as seen when every quote in the watchlist fails', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail());
    // beforeEach already makes getQuote reject by default.

    renderDetail();

    expect(await screen.findByText('quote-error:NVDA:Unavailable')).toBeInTheDocument();
    // Give any stray async work a chance to run before asserting the negative.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(recordWatchlistSeen).not.toHaveBeenCalled();
  });

  it('records as seen when at least one quote succeeds, even if another fails', async () => {
    const stocks = [
      stock({ id: 's1', symbol: 'RELIANCE', position: 0 }),
      stock({ id: 's2', symbol: 'INFY', position: 1 }),
    ];
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail(stocks));
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => {
      if (symbol === 'INFY') throw new ApiError(503, 'Market data is temporarily unavailable.');
      return quote({ symbol: 'RELIANCE', price: '1322.0' });
    });

    renderDetail();

    expect(await screen.findByText('quote-price:RELIANCE:1322.0:live')).toBeInTheDocument();
    expect(await screen.findByText('quote-error:INFY:Unavailable')).toBeInTheDocument();
    // The page itself must remain fully usable despite the partial failure.
    expect(screen.getByText('RELIANCE')).toBeInTheDocument();
    expect(screen.getByText('INFY')).toBeInTheDocument();

    await waitFor(() => expect(recordWatchlistSeen).toHaveBeenCalledWith('w1'));
    expect(recordWatchlistSeen).toHaveBeenCalledTimes(1);
  });

  it('does not break the watchlist UI when the seen endpoint itself fails', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail());
    vi.mocked(getQuote).mockResolvedValueOnce(quote());
    vi.mocked(recordWatchlistSeen).mockRejectedValueOnce(new ApiError(500, 'internal error'));

    renderDetail();

    expect(await screen.findByText('quote-price:NVDA:1322.0:live')).toBeInTheDocument();
    await waitFor(() => expect(recordWatchlistSeen).toHaveBeenCalledWith('w1'));

    // No error toast/UI change leaks from this internal bookkeeping failure --
    // the watchlist keeps working normally (e.g. remove still works).
    await userEvent.click(screen.getByRole('button', { name: 'Remove NVDA' }));
    await waitFor(() => expect(screen.queryByText('NVDA')).not.toBeInTheDocument());
    expect(screen.getByText('NVDA removed')).toBeInTheDocument();
  });

  it('never surfaces snapshot/state bookkeeping language to the user', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail());
    vi.mocked(getQuote).mockResolvedValueOnce(quote());

    renderDetail();

    expect(await screen.findByText('quote-price:NVDA:1322.0:live')).toBeInTheDocument();
    await waitFor(() => expect(recordWatchlistSeen).toHaveBeenCalled());

    for (const forbidden of [/snapshot/i, /last seen/i, /baseline/i, /state recorded/i, /since you/i, /since last/i]) {
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument();
    }
  });

  it('records the correct watchlist id when switching watchlists without a full remount', async () => {
    vi.mocked(getWatchlist).mockImplementation(async (id: string) =>
      id === 'w2'
        ? { id: 'w2', name: 'Growth', stocks: [stock({ id: 's2', symbol: 'AAPL' })], created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
        : detail(),
    );
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => quote({ symbol }));

    renderWithProviders(
      <div>
        <Link to="/watchlists/w1">Go to w1</Link>
        <Link to="/watchlists/w2">Go to w2</Link>
        <Routes>
          <Route path="/watchlists/:watchlistId" element={<WatchlistDetailPage />} />
        </Routes>
      </div>,
      { route: '/watchlists/w1' },
    );

    expect(await screen.findByText('quote-price:NVDA:1322.0:live')).toBeInTheDocument();
    await waitFor(() => expect(recordWatchlistSeen).toHaveBeenCalledWith('w1'));

    await userEvent.click(screen.getByRole('link', { name: 'Go to w2' }));

    expect(await screen.findByText('quote-price:AAPL:1322.0:live')).toBeInTheDocument();
    await waitFor(() => expect(recordWatchlistSeen).toHaveBeenCalledWith('w2'));

    expect(recordWatchlistSeen).toHaveBeenCalledTimes(2);
  });

  it('records again after a manual refresh actually shows a new quote', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail());
    vi.mocked(getQuote).mockResolvedValueOnce(quote());

    renderDetail();

    expect(await screen.findByText('quote-price:NVDA:1322.0:live')).toBeInTheDocument();
    await waitFor(() => expect(recordWatchlistSeen).toHaveBeenCalledTimes(1));

    vi.mocked(getQuote).mockResolvedValueOnce(quote({ price: '1400.0' }));
    await userEvent.click(screen.getByRole('button', { name: 'Refresh quotes' }));

    expect(await screen.findByText('quote-price:NVDA:1400.0:live')).toBeInTheDocument();
    await waitFor(() => expect(recordWatchlistSeen).toHaveBeenCalledTimes(2));
    expect(recordWatchlistSeen).toHaveBeenNthCalledWith(2, 'w1');
  });

  it('does not fire extra seen calls for unrelated re-renders (remove, reorder)', async () => {
    const stocks = [stock({ id: 's1', symbol: 'NVDA', position: 0 }), stock({ id: 's2', symbol: 'AAPL', position: 1 })];
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail(stocks));
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => quote({ symbol }));
    vi.mocked(removeStock).mockResolvedValueOnce(undefined);
    vi.mocked(reorderStocks).mockResolvedValueOnce(detail(stocks));

    renderDetail();

    expect(await screen.findByText('quote-price:NVDA:1322.0:live')).toBeInTheDocument();
    expect(await screen.findByText('quote-price:AAPL:1322.0:live')).toBeInTheDocument();
    await waitFor(() => expect(recordWatchlistSeen).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: 'Simulate reorder' }));
    await waitFor(() => expect(reorderStocks).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: 'Remove NVDA' }));
    await waitFor(() => expect(screen.queryByText('NVDA')).not.toBeInTheDocument());

    // Neither reordering nor removing a stock is a new "the user is looking
    // at this watchlist's current state" moment on its own -- still exactly
    // the one call from the initial load.
    expect(recordWatchlistSeen).toHaveBeenCalledTimes(1);
  });

  it('does not call the seen endpoint once per stock -- one call for the whole watchlist', async () => {
    const stocks = [
      stock({ id: 's1', symbol: 'RELIANCE', position: 0 }),
      stock({ id: 's2', symbol: 'TCS', position: 1 }),
      stock({ id: 's3', symbol: 'HDFC', position: 2 }),
    ];
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail(stocks));
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => quote({ symbol }));

    renderDetail();

    await waitFor(() => expect(recordWatchlistSeen).toHaveBeenCalled());
    expect(recordWatchlistSeen).toHaveBeenCalledTimes(1);
    expect(recordWatchlistSeen).toHaveBeenCalledWith('w1');
  });
});

// ---------------------------------------------------------------------------
// Meaningful changes (Phase 6B)
// ---------------------------------------------------------------------------

describe('Meaningful changes', () => {
  it('shows a normal watchlist with no summary/cards when detected is 0', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail());
    vi.mocked(getQuote).mockResolvedValueOnce(quote());
    vi.mocked(recordWatchlistSeen).mockResolvedValueOnce(seenResult({ detected: 0, changes: [] }));

    renderDetail();

    expect(await screen.findByText('quote-price:NVDA:1322.0:live')).toBeInTheDocument();
    await waitFor(() => expect(recordWatchlistSeen).toHaveBeenCalled());

    expect(screen.queryByText(/meaningful change/i)).not.toBeInTheDocument();
  });

  it('shows the summary line with the actual detected count', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail());
    vi.mocked(getQuote).mockResolvedValueOnce(quote());
    vi.mocked(recordWatchlistSeen).mockResolvedValueOnce(
      seenResult({ detected: 2, changes: [change({ stock_id: 's1' }), change({ stock_id: 's2', symbol: 'AAPL' })] }),
    );

    renderDetail();

    expect(await screen.findByText('2 meaningful changes since you last checked')).toBeInTheDocument();
  });

  it('uses singular wording for exactly one change', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail());
    vi.mocked(getQuote).mockResolvedValueOnce(quote());
    vi.mocked(recordWatchlistSeen).mockResolvedValueOnce(seenResult({ detected: 1, changes: [change()] }));

    renderDetail();

    expect(await screen.findByText('1 meaningful change since you last checked')).toBeInTheDocument();
  });

  it('renders a PRICE_CHANGE card using the backend title/description verbatim', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail());
    vi.mocked(getQuote).mockResolvedValueOnce(quote());
    vi.mocked(recordWatchlistSeen).mockResolvedValueOnce(
      seenResult({
        detected: 1,
        changes: [
          change({
            type: 'PRICE_CHANGE',
            severity: 'HIGH',
            title: 'NVDA moved 10.0% since you last checked',
            description: 'NVDA increased from $1,200.00 to $1,320.00 since your last check.',
            old_value: '1200.00',
            new_value: '1320.00',
          }),
        ],
      }),
    );

    renderDetail();

    expect(await screen.findByText('NVDA moved 10.0% since you last checked')).toBeInTheDocument();
    expect(screen.getByText('NVDA increased from $1,200.00 to $1,320.00 since your last check.')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('renders a VOLUME_SPIKE card using the backend title/description verbatim', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail());
    vi.mocked(getQuote).mockResolvedValueOnce(quote());
    vi.mocked(recordWatchlistSeen).mockResolvedValueOnce(
      seenResult({
        detected: 1,
        changes: [
          change({
            type: 'VOLUME_SPIKE',
            severity: 'MEDIUM',
            title: 'NVDA volume is 70% above average',
            description: 'Trading volume increased from an average of 10.0M shares to 17.0M shares.',
            old_value: '10000000',
            new_value: '17000000',
          }),
        ],
      }),
    );

    renderDetail();

    expect(await screen.findByText('NVDA volume is 70% above average')).toBeInTheDocument();
    expect(
      screen.getByText('Trading volume increased from an average of 10.0M shares to 17.0M shares.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
  });

  it('renders multiple changes with distinct HIGH and MEDIUM severities', async () => {
    const stocks = [
      stock({ id: 's1', symbol: 'NVDA', position: 0 }),
      stock({ id: 's2', symbol: 'AAPL', position: 1 }),
    ];
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail(stocks));
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => quote({ symbol }));
    vi.mocked(recordWatchlistSeen).mockResolvedValueOnce(
      seenResult({
        detected: 2,
        changes: [
          change({ stock_id: 's1', symbol: 'NVDA', severity: 'HIGH', title: 'NVDA moved 12.0% since you last checked' }),
          change({ stock_id: 's2', symbol: 'AAPL', severity: 'MEDIUM', title: 'AAPL moved 4.0% since you last checked' }),
        ],
      }),
    );

    renderDetail();

    expect(await screen.findByText('2 meaningful changes since you last checked')).toBeInTheDocument();
    expect(screen.getByText('NVDA moved 12.0% since you last checked')).toBeInTheDocument();
    expect(screen.getByText('AAPL moved 4.0% since you last checked')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
  });

  it('handles an unrecognized severity value gracefully instead of crashing', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail());
    vi.mocked(getQuote).mockResolvedValueOnce(quote());
    vi.mocked(recordWatchlistSeen).mockResolvedValueOnce(
      seenResult({ detected: 1, changes: [change({ severity: 'CRITICAL' })] }),
    );

    renderDetail();

    expect(await screen.findByText('Critical')).toBeInTheDocument();
  });

  it('clears the previous watchlist changes when switching to a different watchlist', async () => {
    vi.mocked(getWatchlist).mockImplementation(async (id: string) =>
      id === 'w2'
        ? { id: 'w2', name: 'Growth', stocks: [stock({ id: 's2', symbol: 'AAPL' })], created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
        : detail(),
    );
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => quote({ symbol }));
    vi.mocked(recordWatchlistSeen).mockImplementation(async (id: string) =>
      id === 'w1'
        ? seenResult({ watchlist_id: 'w1', detected: 1, changes: [change({ symbol: 'NVDA' })] })
        : seenResult({ watchlist_id: 'w2', detected: 0, changes: [] }),
    );

    renderWithProviders(
      <div>
        <Link to="/watchlists/w1">Go to w1</Link>
        <Link to="/watchlists/w2">Go to w2</Link>
        <Routes>
          <Route path="/watchlists/:watchlistId" element={<WatchlistDetailPage />} />
        </Routes>
      </div>,
      { route: '/watchlists/w1' },
    );

    expect(await screen.findByText('1 meaningful change since you last checked')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Go to w2' }));

    expect(await screen.findByText('quote-price:AAPL:1322.0:live')).toBeInTheDocument();
    await waitFor(() => expect(recordWatchlistSeen).toHaveBeenCalledWith('w2'));
    expect(screen.queryByText(/meaningful change/i)).not.toBeInTheDocument();
  });

  it('does not fabricate or clear changes when the seen request fails', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail());
    vi.mocked(getQuote).mockResolvedValueOnce(quote());
    vi.mocked(recordWatchlistSeen).mockRejectedValueOnce(new ApiError(500, 'internal error'));

    renderDetail();

    expect(await screen.findByText('quote-price:NVDA:1322.0:live')).toBeInTheDocument();
    await waitFor(() => expect(recordWatchlistSeen).toHaveBeenCalled());

    // Quotes are still visible; no changes summary is fabricated.
    expect(screen.getByText('quote-price:NVDA:1322.0:live')).toBeInTheDocument();
    expect(screen.queryByText(/meaningful change/i)).not.toBeInTheDocument();
  });

  it('updates the meaningful changes after a manual refresh', async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(detail());
    vi.mocked(getQuote).mockResolvedValueOnce(quote());
    vi.mocked(recordWatchlistSeen).mockResolvedValueOnce(seenResult({ detected: 0, changes: [] }));

    renderDetail();

    expect(await screen.findByText('quote-price:NVDA:1322.0:live')).toBeInTheDocument();
    await waitFor(() => expect(recordWatchlistSeen).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/meaningful change/i)).not.toBeInTheDocument();

    vi.mocked(getQuote).mockResolvedValueOnce(quote({ price: '1400.0' }));
    vi.mocked(recordWatchlistSeen).mockResolvedValueOnce(
      seenResult({ detected: 1, changes: [change({ title: 'NVDA moved 6.0% since you last checked' })] }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Refresh quotes' }));

    expect(await screen.findByText('NVDA moved 6.0% since you last checked')).toBeInTheDocument();
    expect(await screen.findByText('1 meaningful change since you last checked')).toBeInTheDocument();
  });
});
