import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
}));

vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: mocks.user,
    loading: false,
    cloudEnabled: true,
    configurationError: null,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    requestPasswordReset: vi.fn(),
  }),
}));

vi.mock('./AppShell', () => ({
  AppShell: () => <Outlet />,
}));

vi.mock('../features/securities/WatchlistPage', () => ({
  WatchlistPage: () => <div data-testid="watchlist-page">自选股页面</div>,
}));

import { appRoutes } from './router';

describe('securities account routes', () => {
  beforeEach(() => {
    mocks.user = null;
  });

  it.each([
    '/securities',
    '/securities/watchlist',
    '/securities/stock/600519',
    '/projects/project-a/securities',
    '/projects/project-a/securities/portfolio',
  ])('redirects unauthenticated access to login from %s', async path => {
    const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: '登录证券账户' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.state).toEqual({ from: path });
  });

  it('allows an authenticated user to open a securities subpage', async () => {
    mocks.user = { id: 'user-a', email: 'owner@example.com' };
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/securities/watchlist'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByTestId('watchlist-page')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/securities/watchlist');
  });

  it('does not protect the investment research project list', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/'] });
    render(<RouterProvider router={router} />);

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
