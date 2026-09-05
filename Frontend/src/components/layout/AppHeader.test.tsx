import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppHeader } from './AppHeader';
import { mockUser, renderWithProviders } from '../../test/testUtils';

vi.mock('../../api/auth', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    meRequest: vi.fn(),
    loginRequest: vi.fn(),
    registerRequest: vi.fn(),
    logoutRequest: vi.fn(),
    ApiError: actual.ApiError,
  };
});

import { meRequest } from '../../api/auth';

beforeEach(() => {
  vi.mocked(meRequest).mockResolvedValue(mockUser);
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

// jsdom does not reliably apply the desktop/mobile @media swap that shows
// the avatar menu vs. the hamburger menu (see regression.test.tsx), so this
// exercises the (equally real) hamburger menu's items -- same shared
// DropdownMenu component and the same themeMenuItem either way.
describe('AppHeader theme toggle', () => {
  it('defaults to light and offers "Switch to dark mode" above Log out', async () => {
    renderWithProviders(<AppHeader />);

    await userEvent.click(await screen.findByRole('button', { name: 'Open menu' }));

    const menuItems = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(menuItems.slice(-2)).toEqual(['Switch to dark mode', 'Log out']);
    expect(document.documentElement.getAttribute('data-theme')).not.toBe('dark');
  });

  it('switches to dark mode, persists it, and flips the label', async () => {
    renderWithProviders(<AppHeader />);

    await userEvent.click(await screen.findByRole('button', { name: 'Open menu' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Switch to dark mode' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('theme')).toBe('dark');

    await userEvent.click(await screen.findByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('menuitem', { name: 'Switch to light mode' })).toBeInTheDocument();
  });

  it('switches back to light mode on a second toggle', async () => {
    renderWithProviders(<AppHeader />);

    await userEvent.click(await screen.findByRole('button', { name: 'Open menu' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Switch to dark mode' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open menu' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Switch to light mode' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem('theme')).toBe('light');
  });

  it('remembers a previously chosen theme across a fresh mount', async () => {
    window.localStorage.setItem('theme', 'dark');

    renderWithProviders(<AppHeader />);

    expect(await screen.findByRole('button', { name: 'Open menu' })).toBeInTheDocument();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
