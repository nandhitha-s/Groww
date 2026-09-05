import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangesPage } from './ChangesPage';
import { mockUser, renderWithProviders } from '../test/testUtils';
import { ApiError } from '../api/client';
import type { ChangeEventListItem, ChangeEventListResponse } from '../types/changes';

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

vi.mock('../api/changes', () => ({
  getChanges: vi.fn(),
  acknowledgeChange: vi.fn(),
}));

import { meRequest } from '../api/auth';
import { acknowledgeChange, getChanges } from '../api/changes';

function item(overrides: Partial<ChangeEventListItem> = {}): ChangeEventListItem {
  return {
    id: 'c1',
    stock_id: 's1',
    symbol: 'NVDA',
    watchlist_id: 'w1',
    type: 'PRICE_CHANGE',
    severity: 'HIGH',
    title: 'NVDA moved 12.0% since you last checked',
    description: 'NVDA increased from ₹1,200.00 to ₹1,344.00 since your last check.',
    old_value: '1200.00',
    new_value: '1344.00',
    detected_at: new Date().toISOString(),
    acknowledged_at: null,
    ...overrides,
  };
}

function response(
  items: ChangeEventListItem[],
  overrides: Partial<ChangeEventListResponse> = {},
): ChangeEventListResponse {
  return { items, limit: 50, count: items.length, ...overrides };
}

beforeEach(() => {
  vi.mocked(meRequest).mockResolvedValue(mockUser);
  vi.mocked(getChanges).mockReset();
  vi.mocked(acknowledgeChange).mockReset();
});

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/changes" element={<ChangesPage />} />
      <Route path="/stocks/:symbol" element={<div>Stock detail page</div>} />
      <Route path="/watchlists" element={<div>Watchlists page</div>} />
    </Routes>,
    { route: '/changes' },
  );
}

describe('ChangesPage', () => {
  it('loads and renders events', async () => {
    vi.mocked(getChanges).mockResolvedValueOnce(response([item()]));

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Changes' })).toBeInTheDocument();
    expect(await screen.findByText('NVDA moved 12.0% since you last checked')).toBeInTheDocument();
  });

  it('shows HIGH and MEDIUM severity correctly', async () => {
    vi.mocked(getChanges).mockResolvedValueOnce(
      response([
        item({ id: 'c1', symbol: 'NVDA', severity: 'HIGH' }),
        item({
          id: 'c2',
          symbol: 'AAPL',
          severity: 'MEDIUM',
          title: 'AAPL moved 6.0% since you last checked',
        }),
      ]),
    );

    renderPage();

    await screen.findByText('NVDA moved 12.0% since you last checked');
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
  });

  it('filters by High Impact', async () => {
    vi.mocked(getChanges).mockResolvedValueOnce(
      response([
        item({ id: 'c1', symbol: 'NVDA', severity: 'HIGH', title: 'NVDA moved 12.0% since you last checked' }),
        item({ id: 'c2', symbol: 'AAPL', severity: 'MEDIUM', title: 'AAPL moved 6.0% since you last checked' }),
      ]),
    );

    renderPage();
    await screen.findByText('AAPL moved 6.0% since you last checked');

    await userEvent.click(screen.getByRole('button', { name: 'High Impact' }));

    expect(screen.queryByText('AAPL moved 6.0% since you last checked')).not.toBeInTheDocument();
    expect(screen.getByText('NVDA moved 12.0% since you last checked')).toBeInTheDocument();
  });

  it('filters by Volume', async () => {
    vi.mocked(getChanges).mockResolvedValueOnce(
      response([
        item({ id: 'c1', symbol: 'NVDA', type: 'PRICE_CHANGE', title: 'NVDA moved 12.0% since you last checked' }),
        item({ id: 'c2', symbol: 'AAPL', type: 'VOLUME_SPIKE', title: 'AAPL volume is 150% above average' }),
      ]),
    );

    renderPage();
    await screen.findByText('NVDA moved 12.0% since you last checked');

    await userEvent.click(screen.getByRole('button', { name: 'Volume' }));

    expect(screen.queryByText('NVDA moved 12.0% since you last checked')).not.toBeInTheDocument();
    expect(screen.getByText('AAPL volume is 150% above average')).toBeInTheDocument();
  });

  it('groups events into Today / Yesterday / Earlier using local time', async () => {
    const today = new Date().toISOString();
    const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
    const earlier = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(getChanges).mockResolvedValueOnce(
      response([
        item({ id: 'c1', symbol: 'NVDA', detected_at: today, title: 'today change' }),
        item({ id: 'c2', symbol: 'AAPL', detected_at: yesterday, title: 'yesterday change' }),
        item({ id: 'c3', symbol: 'TSLA', detected_at: earlier, title: 'earlier change' }),
      ]),
    );

    renderPage();

    await screen.findByText('today change');
    expect(screen.getByText('TODAY')).toBeInTheDocument();
    expect(screen.getByText('YESTERDAY')).toBeInTheDocument();
    expect(screen.getByText('EARLIER')).toBeInTheDocument();
  });

  it("shows the empty state when there are no events at all", async () => {
    vi.mocked(getChanges).mockResolvedValueOnce(response([]));

    renderPage();

    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
    expect(screen.getByText('No meaningful changes have been detected yet.')).toBeInTheDocument();
  });

  it('shows a message with a way back to All when a filter matches nothing', async () => {
    vi.mocked(getChanges).mockResolvedValueOnce(
      response([item({ severity: 'MEDIUM', title: 'the only change' })]),
    );

    renderPage();
    await screen.findByText('the only change');

    await userEvent.click(screen.getByRole('button', { name: 'High Impact' }));

    expect(await screen.findByText('No changes match this filter.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(await screen.findByText('the only change')).toBeInTheDocument();
  });

  it('shows an error state with retry', async () => {
    vi.mocked(getChanges).mockRejectedValueOnce(new ApiError(500, 'server error'));

    renderPage();
    expect(await screen.findByText("Couldn't load changes")).toBeInTheDocument();

    vi.mocked(getChanges).mockResolvedValueOnce(response([item()]));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('NVDA moved 12.0% since you last checked')).toBeInTheDocument();
  });

  it('navigates to the stock detail page when a change is clicked', async () => {
    vi.mocked(getChanges).mockResolvedValueOnce(response([item()]));
    renderPage();

    await userEvent.click(await screen.findByText('NVDA moved 12.0% since you last checked'));

    expect(await screen.findByText('Stock detail page')).toBeInTheDocument();
  });

  it('acknowledges a change', async () => {
    vi.mocked(getChanges).mockResolvedValueOnce(response([item()]));
    vi.mocked(acknowledgeChange).mockResolvedValueOnce(
      item({ acknowledged_at: '2026-01-05T10:00:00Z' }),
    );

    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Mark as read' }));

    expect(await screen.findByRole('button', { name: '✓ Read' })).toBeInTheDocument();
    expect(acknowledgeChange).toHaveBeenCalledWith('c1');
  });
});
