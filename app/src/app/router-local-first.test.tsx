import { render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: null,
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

import { appRoutes } from './router';

describe('securities route account boundary', () => {
  it('requires login before showing the local-first securities workbench', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/securities'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: '登录证券账户' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });
});
