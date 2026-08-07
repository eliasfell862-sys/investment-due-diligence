import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteVaultRecord } from './ai-vault-db';
import { AiVaultProvider, resolveVaultNamespace } from './AiVaultProvider';
import type { AiAgentSettings } from './types';
import { useAiVault } from './useAiVault';

const auth = vi.hoisted(() => ({
  user: { id: 'user-a' } as { id: string } | null,
  loading: false,
}));

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: auth.user,
    loading: auth.loading,
    cloudEnabled: true,
    configurationError: null,
  }),
}));

const settings: AiAgentSettings = {
  defaultProfile: {
    providerId: 'deepseek',
    model: 'deepseek-chat',
    endpoint: 'https://api.deepseek.com/chat/completions',
    temperature: 0.2,
    maxOutputTokens: 2_000,
  },
  featureOverrides: {},
  connectionStatuses: {},
  updatedAt: '2026-08-07T00:00:00.000Z',
};

function Wrapper({ children }: { children: ReactNode }) {
  return <AiVaultProvider>{children}</AiVaultProvider>;
}

describe('AiVaultProvider', () => {
  beforeEach(async () => {
    auth.user = { id: 'user-a' };
    auth.loading = false;
    await Promise.all(['user-a', 'user-b'].map(deleteVaultRecord));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the authenticated user ID and starts locked after loading', async () => {
    const { result } = renderHook(() => useAiVault(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.namespace).toBe('user-a');
    expect(result.current.locked).toBe(true);
  });

  it('keeps guest mode opt-in only', () => {
    expect(resolveVaultNamespace(null)).toBeNull();
    expect(resolveVaultNamespace(null, { allowGuest: true })).toBe('local-guest');
  });

  it('clears plaintext access when locked', async () => {
    const { result } = renderHook(() => useAiVault(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.createVault('vault-pass-123', settings));
    await act(() => result.current.setSecret('default:deepseek', 'deepseek', 'sk-secret-1234'));
    expect(result.current.resolveSecret('default:deepseek')).toBe('sk-secret-1234');

    act(() => result.current.lock());
    expect(result.current.resolveSecret('default:deepseek')).toBeNull();
    expect(result.current.settings).toBeNull();
  });

  it('locks immediately when the authenticated user changes', async () => {
    const { result, rerender } = renderHook(() => useAiVault(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.createVault('vault-pass-123', settings));

    auth.user = { id: 'user-b' };
    rerender();

    await waitFor(() => expect(result.current.namespace).toBe('user-b'));
    expect(result.current.locked).toBe(true);
    expect(result.current.settings).toBeNull();
  });

  it('locks when the user signs out', async () => {
    const { result, rerender } = renderHook(() => useAiVault(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.createVault('vault-pass-123', settings));

    auth.user = null;
    rerender();

    await waitFor(() => expect(result.current.namespace).toBeNull());
    expect(result.current.locked).toBe(true);
  });

  it('locks after being in the background for thirty minutes', async () => {
    const { result } = renderHook(() => useAiVault(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.createVault('vault-pass-123', settings));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T00:00:00.000Z'));

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    vi.advanceTimersByTime(30 * 60 * 1_000);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));

    expect(result.current.locked).toBe(true);
  });

  it('delays retries after five failed unlock attempts and resets after success', async () => {
    const { result } = renderHook(() => useAiVault(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.createVault('vault-pass-123', settings));
    act(() => result.current.lock());

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await act(async () => {
        await expect(result.current.unlock('wrong-pass-123')).rejects.toThrow(
          '密钥库密码错误',
        );
      });
    }

    expect(result.current.retryAfter).toBeGreaterThan(Date.now());
    await expect(result.current.unlock('vault-pass-123')).rejects.toThrow(
      '尝试次数过多，请稍后再试',
    );
  });
});
