import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readAuthEnvironment: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  unsubscribe: vi.fn(),
  listener: null as ((event: AuthChangeEvent, session: Session | null) => void) | null,
}));

vi.mock('../../infrastructure/cloud/cloud-environment', () => ({
  readAuthEnvironment: mocks.readAuthEnvironment,
}));

vi.mock('../../infrastructure/cloud/supabase-client', () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
      signInWithPassword: mocks.signInWithPassword,
      signUp: mocks.signUp,
      signOut: mocks.signOut,
      resetPasswordForEmail: mocks.resetPasswordForEmail,
    },
  }),
}));

import { readCachedWatchlists, writeCachedWatchlists } from '../securities/securities-account-cache';
import { AuthProvider, useAuth } from './AuthProvider';

function session(userId: string, email: string): Session {
  return {
    access_token: 'access',
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: userId,
      email,
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2026-08-07T00:00:00.000Z',
    },
  } as Session;
}

function Wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe('AuthProvider', () => {
  beforeEach(() => {
    mocks.listener = null;
    mocks.readAuthEnvironment.mockReset().mockReturnValue({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
    });
    mocks.unsubscribe.mockReset();
    mocks.getSession.mockReset().mockResolvedValue({ data: { session: null }, error: null });
    mocks.onAuthStateChange.mockReset().mockImplementation((listener) => {
      mocks.listener = listener;
      return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
    });
    mocks.signInWithPassword.mockReset().mockResolvedValue({ error: null });
    mocks.signUp.mockReset().mockResolvedValue({ error: null });
    mocks.signOut.mockReset().mockResolvedValue({ error: null });
    mocks.resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
  });

  it('enables authentication without requiring VAPID', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.cloudEnabled).toBe(true);
    expect(result.current.configurationError).toBeNull();
  });

  it('surfaces missing authentication configuration without creating a client', () => {
    mocks.readAuthEnvironment.mockReturnValue(null);
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });

    expect(result.current.loading).toBe(false);
    expect(result.current.cloudEnabled).toBe(false);
    expect(result.current.configurationError).toBe('Authentication is not configured');
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it('restores the current session and reacts to auth changes', async () => {
    const firstSession = session('user-a', 'a@example.com');
    mocks.getSession.mockResolvedValue({ data: { session: firstSession }, error: null });

    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.user?.id).toBe('user-a'));
    act(() => mocks.listener?.('SIGNED_OUT', null));
    await waitFor(() => expect(result.current.user).toBeNull());
  });

  it('uses email and password for sign in and registration', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.signIn('owner@example.com', 'password123'));
    await act(() => result.current.signUp('owner@example.com', 'password123'));

    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: 'owner@example.com',
      password: 'password123',
    });
    expect(mocks.signUp).toHaveBeenCalledWith({
      email: 'owner@example.com',
      password: 'password123',
    });
  });

  it('clears the signed-in account securities cache after sign-out succeeds', async () => {
    const currentSession = session('user-a', 'a@example.com');
    mocks.getSession.mockResolvedValue({ data: { session: currentSession }, error: null });
    writeCachedWatchlists('user-a', [{
      id: 'main', name: 'cached', createdAt: '2026-08-12', codes: ['000001'], groups: [], codeGroups: {},
    }]);
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.user?.id).toBe('user-a'));

    await act(() => result.current.signOut());

    expect(readCachedWatchlists('user-a')).toBeNull();
  });
  it('surfaces authentication errors', async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: new Error('Invalid credentials') });
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.signIn('owner@example.com', 'bad-password'))
      .rejects.toThrow('Invalid credentials');
  });
});
