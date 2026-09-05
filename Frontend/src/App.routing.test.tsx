import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import { mockUser } from './test/testUtils';

vi.mock('./api/auth', async () => {
  const actual = await vi.importActual<typeof import('./api/client')>('./api/client');
  return {
    meRequest: vi.fn(),
    loginRequest: vi.fn(),
    registerRequest: vi.fn(),
    logoutRequest: vi.fn(),
    ApiError: actual.ApiError,
  };
});

vi.mock('./api/watchlists', () => ({
  getWatchlists: vi.fn().mockResolvedValue([]),
  getWatchlist: vi.fn(),
  createWatchlist: vi.fn(),
  renameWatchlist: vi.fn(),
  deleteWatchlist: vi.fn(),
  addStock: vi.fn(),
  removeStock: vi.fn(),
  reorderStocks: vi.fn(),
  recordWatchlistSeen: vi.fn(),
}));

import { meRequest } from './api/auth';
import { getWatchlists } from './api/watchlists';

describe('routing', () => {
  it('redirects an unauthenticated user away from /watchlists', async () => {
    vi.mocked(meRequest).mockRejectedValueOnce(new Error('not authenticated'));

    render(
      <MemoryRouter initialEntries={['/watchlists']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
  });

  it('redirects an unauthenticated user away from a watchlist detail route', async () => {
    vi.mocked(meRequest).mockRejectedValueOnce(new Error('not authenticated'));

    render(
      <MemoryRouter initialEntries={['/watchlists/abc-123']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
  });

  it('allows an authenticated user to reach /watchlists', async () => {
    vi.mocked(meRequest).mockResolvedValueOnce(mockUser);
    vi.mocked(getWatchlists).mockResolvedValueOnce([
      {
        id: 'w1',
        name: 'Technology',
        stock_count: 2,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]);

    render(
      <MemoryRouter initialEntries={['/watchlists']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('My Watchlists')).toBeInTheDocument();
  });
});
