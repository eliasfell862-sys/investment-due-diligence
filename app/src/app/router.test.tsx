import { render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-a', email: 'owner@example.com' },
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

vi.mock('../features/securities/SecuritiesWorkbenchPage', () => ({
  SecuritiesWorkbenchPage: () => <h1>证券项目工作台</h1>,
}));

import { appRoutes } from './router';

describe('application routes', () => {
  it('registers root and project pre-move radar routes', () => {
    const children = appRoutes[0]?.children ?? [];
    expect(children.some(route => route.path === 'securities/pre-move-radar')).toBe(true);
    expect(children.some(route => route.path === 'projects/:projectId/securities/pre-move-radar')).toBe(true);
  });

  it('renders the securities workbench at /securities for an authenticated user', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/securities'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: '证券项目工作台' })).toBeInTheDocument();
  });
});
