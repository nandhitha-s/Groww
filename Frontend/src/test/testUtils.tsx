import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import { ThemeProvider } from '../context/ThemeContext';
import { ToastProvider } from '../context/ToastContext';
import type { UserPublic } from '../api/auth';

export const mockUser: UserPublic = {
  id: 'user-1',
  name: 'Alice',
  email: 'alice@example.com',
};

export function renderWithProviders(
  ui: ReactElement,
  { route = '/' }: { route?: string | { pathname: string; state?: unknown } } = {},
) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>{ui}</ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}
