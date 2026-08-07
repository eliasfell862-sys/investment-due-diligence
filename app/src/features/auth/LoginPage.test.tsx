import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  requestPasswordReset: vi.fn(),
}));

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    cloudEnabled: true,
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

    expect(await screen.findByText('密码至少需要8位')).toBeInTheDocument();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it('switches to registration and surfaces service errors', async () => {
    const user = userEvent.setup();
    mocks.signUp.mockRejectedValue(new Error('Email already registered'));
    renderPage();

    await user.click(screen.getByRole('button', { name: '创建账户' }));
    await user.type(screen.getByLabelText('邮箱'), 'owner@example.com');
    await user.type(screen.getByLabelText('密码'), 'password123');
    await user.click(screen.getByRole('button', { name: '注册' }));

    expect(await screen.findByText('Email already registered')).toBeInTheDocument();
  });
});
