import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WatchlistsPage } from './WatchlistsPage';
import { mockUser, renderWithProviders } from '../test/testUtils';

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
  createWatchlist: vi.fn(),
  deleteWatchlist: vi.fn(),
  getWatchlist: vi.fn(),
  renameWatchlist: vi.fn(),
  addStock: vi.fn(),
  removeStock: vi.fn(),
  reorderStocks: vi.fn(),
}));

import { meRequest } from '../api/auth';
import { ApiError } from '../api/client';
import { createWatchlist, getWatchlists } from '../api/watchlists';

const summary = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'w1',
  name: 'Technology',
  stock_count: 2,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

beforeEach(() => {
  vi.mocked(meRequest).mockResolvedValue(mockUser);
});

describe('WatchlistsPage', () => {
  it('shows a loading skeleton before data arrives', async () => {
    let resolveList!: (value: ReturnType<typeof summary>[]) => void;
    vi.mocked(getWatchlists).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );

    renderWithProviders(<WatchlistsPage />);

    expect(await screen.findByText('My Watchlists')).toBeInTheDocument();
    expect(document.querySelectorAll('.skeleton').length).toBeGreaterThan(0);

    resolveList([]);
  });

  it('renders watchlist cards once loaded', async () => {
    vi.mocked(getWatchlists).mockResolvedValueOnce([summary()]);

    renderWithProviders(<WatchlistsPage />);

    expect(await screen.findByText('Technology')).toBeInTheDocument();
    expect(screen.getByText('2 stocks')).toBeInTheDocument();
  });

  it('shows the empty state when there are no watchlists', async () => {
    vi.mocked(getWatchlists).mockResolvedValueOnce([]);

    renderWithProviders(<WatchlistsPage />);

    expect(await screen.findByText('Build your first watchlist')).toBeInTheDocument();
  });

  it('shows an error state with retry on load failure', async () => {
    vi.mocked(getWatchlists).mockRejectedValueOnce(new ApiError(500, 'boom'));

    renderWithProviders(<WatchlistsPage />);

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();

    vi.mocked(getWatchlists).mockResolvedValueOnce([summary()]);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Technology')).toBeInTheDocument();
  });

  it('creates a watchlist through the dialog and shows it in the grid', async () => {
    vi.mocked(getWatchlists).mockResolvedValueOnce([]);
    vi.mocked(createWatchlist).mockResolvedValueOnce(summary({ name: 'Dividend Picks', stock_count: 0 }));

    renderWithProviders(<WatchlistsPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Create Watchlist/i }));
    await userEvent.type(screen.getByLabelText('Watchlist name'), 'Dividend Picks');
    await userEvent.click(screen.getByRole('button', { name: 'Create watchlist' }));

    expect(await screen.findByText('Dividend Picks')).toBeInTheDocument();
    expect(screen.getByText('Watchlist created')).toBeInTheDocument();
  });

  it('shows an inline error for a duplicate watchlist name', async () => {
    vi.mocked(getWatchlists).mockResolvedValueOnce([summary()]);
    vi.mocked(createWatchlist).mockRejectedValueOnce(
      new ApiError(409, 'A watchlist with this name already exists'),
    );

    renderWithProviders(<WatchlistsPage />);

    await userEvent.click(await screen.findByRole('button', { name: /New Watchlist/i }));
    await userEvent.type(screen.getByLabelText('Watchlist name'), 'Technology');
    await userEvent.click(screen.getByRole('button', { name: 'Create watchlist' }));

    expect(
      await screen.findByText('A watchlist with this name already exists.'),
    ).toBeInTheDocument();
  });

  it('rejects an empty watchlist name without calling the API', async () => {
    vi.mocked(getWatchlists).mockResolvedValueOnce([summary()]);

    renderWithProviders(<WatchlistsPage />);

    await userEvent.click(await screen.findByRole('button', { name: /New Watchlist/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Create watchlist' }));

    expect(await screen.findByText('Enter a name for your watchlist.')).toBeInTheDocument();
    expect(createWatchlist).not.toHaveBeenCalled();
  });

  it('deletes a watchlist from the card menu', async () => {
    const { deleteWatchlist } = await import('../api/watchlists');
    vi.mocked(getWatchlists).mockResolvedValueOnce([summary()]);
    vi.mocked(deleteWatchlist).mockResolvedValueOnce(undefined);

    renderWithProviders(<WatchlistsPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Open Technology menu' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete watchlist' }));

    await waitFor(() => expect(screen.queryByText('Technology')).not.toBeInTheDocument());
    expect(screen.getByText('Watchlist deleted')).toBeInTheDocument();
  });
});
