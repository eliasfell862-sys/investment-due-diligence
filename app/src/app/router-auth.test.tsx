import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../features/auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    user: null,
    loading: false,
    cloudEnabled: true,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    requestPasswordReset: vi.fn(),
  }),
}));

import { appRoutes } from './router';

describe('cloud account routes', () => {
  it('renders the email and password login page at /login', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/login'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: '登录证券账户' })).toBeInTheDocument();
  });
});
