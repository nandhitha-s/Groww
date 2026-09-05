import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

import { loginRequest, logoutRequest, meRequest, registerRequest } from './api/auth';
import { ApiError } from './api/client';

function renderApp(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(meRequest).mockReset();
});

describe('Phase 2 regression', () => {
  it('login works and lands on the dashboard', async () => {
    vi.mocked(meRequest).mockRejectedValueOnce(new Error('unauthenticated'));
    vi.mocked(loginRequest).mockResolvedValueOnce(mockUser);

    renderApp('/login');

    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Email'), 'alice@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByText(/Alice/)).toBeInTheDocument();
  });

  it('shows a generic error for invalid login credentials', async () => {
    vi.mocked(meRequest).mockRejectedValueOnce(new Error('unauthenticated'));
    vi.mocked(loginRequest).mockRejectedValueOnce(new ApiError(401, 'Invalid email or password'));

    renderApp('/login');

    await userEvent.type(await screen.findByLabelText('Email'), 'alice@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
  });

  it('register works and lands on the dashboard', async () => {
    vi.mocked(meRequest).mockRejectedValueOnce(new Error('unauthenticated'));
    vi.mocked(registerRequest).mockResolvedValueOnce(mockUser);

    renderApp('/register');

    expect(await screen.findByText('Start watching smarter.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Name'), 'Alice');
    await userEvent.type(screen.getByLabelText('Email'), 'alice@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await userEvent.type(screen.getByLabelText('Confirm Password'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText(/Alice/)).toBeInTheDocument();
  });

  it('restores an existing session on load without showing the login page', async () => {
    vi.mocked(meRequest).mockResolvedValueOnce(mockUser);

    renderApp('/dashboard');

    expect(await screen.findByText(/Alice/)).toBeInTheDocument();
    expect(screen.queryByText('Welcome back')).not.toBeInTheDocument();
  });

  it('redirects an unauthenticated user away from /dashboard', async () => {
    vi.mocked(meRequest).mockRejectedValueOnce(new Error('unauthenticated'));

    renderApp('/dashboard');

    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
  });

  it('logs out and returns to the login page', async () => {
    vi.mocked(meRequest).mockResolvedValueOnce(mockUser);
    vi.mocked(logoutRequest).mockResolvedValueOnce(undefined);

    renderApp('/dashboard');

    // jsdom does not reliably apply the desktop/mobile @media swap that
    // shows the avatar menu vs. the hamburger menu, so this exercises the
    // (equally real) hamburger menu's "Log out" item instead.
    await userEvent.click(await screen.findByRole('button', { name: 'Open menu' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Log out' }));

    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
  });

  it('the dashboard navigates to My Watchlists', async () => {
    vi.mocked(meRequest).mockResolvedValueOnce(mockUser);

    renderApp('/dashboard');

    await userEvent.click(await screen.findByRole('button', { name: /Go to My Watchlists/i }));

    // Confirms the /watchlists route rendered (its own empty state's CTA,
    // distinct from the dashboard's "Go to My Watchlists" button).
    expect(await screen.findByRole('button', { name: 'Create Watchlist' })).toBeInTheDocument();
  });
});
