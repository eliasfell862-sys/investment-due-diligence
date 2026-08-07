import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: {
    user: null as { id: string } | null,
    loading: false,
    cloudEnabled: true,
    configurationError: null as string | null,
  },
  signIn: vi.fn(),
  signUp: vi.fn(),
  requestPasswordReset: vi.fn(),
}));

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({
    ...mocks.state,
    signIn: mocks.signIn,
    signUp: mocks.signUp,
    signOut: vi.fn(),
    requestPasswordReset: mocks.requestPasswordReset,
  }),
}));

import { LoginPage } from './LoginPage';

function renderPage() {
  return render(<MemoryRouter><LoginPage /></MemoryRouter>);
}

describe('LoginPage', () => {
  beforeEach(() => {
    mocks.state.user = null;
    mocks.state.loading = false;
    mocks.state.cloudEnabled = true;
    mocks.state.configurationError = null;
    mocks.signIn.mockReset().mockResolvedValue(undefined);
    mocks.signUp.mockReset().mockResolvedValue(undefined);
    mocks.requestPasswordReset.mockReset().mockResolvedValue(undefined);
  });

  it('submits an email and password login', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('邮箱'), 'owner@example.com');
    await user.type(screen.getByLabelText('密码'), 'password123');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(mocks.signIn).toHaveBeenCalledWith('owner@example.com', 'password123');
  });

  it('requires at least eight password characters', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('邮箱'), 'owner@example.com');
    await user.type(screen.getByLabelText('密码'), 'short');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByText('密码至少需要 8 位')).toBeInTheDocument();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it('tells a new user to verify their email', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: '创建账户' }));
    await user.type(screen.getByLabelText('邮箱'), 'owner@example.com');
    await user.type(screen.getByLabelText('密码'), 'password123');
    await user.click(screen.getByRole('button', { name: '注册' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('注册成功，请查收验证邮件后再登录');
  });

  it('shows session recovery before rendering the form', () => {
    mocks.state.loading = true;
    renderPage();

    expect(screen.getByRole('status')).toHaveTextContent('正在恢复账户会话…');
    expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument();
  });

  it('shows a stable configuration error instead of redirecting', () => {
    mocks.state.cloudEnabled = false;
    mocks.state.configurationError = 'Authentication is not configured';
    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent('证券账户服务尚未配置，请联系管理员');
    expect(screen.getByText('Authentication is not configured')).toBeInTheDocument();
  });

  it('returns to the protected securities destination after login', async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter([
      { path: '/login', element: <LoginPage /> },
      { path: '/securities/watchlist', element: <div>自选股页面</div> },
    ], {
      initialEntries: [{ pathname: '/login', state: { from: '/securities/watchlist' } }],
    });
    render(<RouterProvider router={router} />);

    await user.type(screen.getByLabelText('邮箱'), 'owner@example.com');
    await user.type(screen.getByLabelText('密码'), 'password123');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(router.state.location.pathname).toBe('/securities/watchlist');
  });
});
