import 'fake-indexeddb/auto';

import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiGatewayError } from './ai-provider-adapter';
import {
  getAiGatewayRuntime,
  registerAiGatewayRuntime,
  unregisterAiGatewayRuntime,
} from './ai-gateway-runtime';
import { AiVaultProvider } from './AiVaultProvider';
import { deleteVaultRecord } from './ai-vault-db';
import type { AiAgentSettings } from './types';
import { useAiVault } from './useAiVault';

const auth = vi.hoisted(() => ({
  user: { id: 'runtime-user' } as { id: string } | null,
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
    providerId: 'deepseek', model: 'deepseek-chat',
    endpoint: 'https://api.deepseek.com/chat/completions',
    temperature: 0.2, maxOutputTokens: 2_000,
  },
  featureOverrides: {}, connectionStatuses: {}, updatedAt: '2026-08-07T00:00:00.000Z',
};

describe('ai-gateway runtime registry', () => {
  beforeEach(() => {
    unregisterAiGatewayRuntime();
  });

  it('throws vault_locked when nothing is registered', () => {
    expect(() => getAiGatewayRuntime()).toThrow(AiGatewayError);
    try {
      getAiGatewayRuntime();
    } catch (error) {
      expect((error as AiGatewayError).code).toBe('vault_locked');
    }
  });

  it('returns the registered runtime and throws again after unregister', () => {
    const runtime = { settings, resolveSecret: () => null };
    registerAiGatewayRuntime(runtime);
    expect(getAiGatewayRuntime()).toBe(runtime);

    unregisterAiGatewayRuntime();
    expect(() => getAiGatewayRuntime()).toThrow(AiGatewayError);
  });

  it('rejects a runtime without settings as locked', () => {
    registerAiGatewayRuntime({ settings: null, resolveSecret: () => null });
    expect(() => getAiGatewayRuntime()).toThrow(AiGatewayError);
  });
});

describe('AiVaultProvider runtime registration', () => {
  beforeEach(async () => {
    auth.user = { id: 'runtime-user' };
    auth.loading = false;
    unregisterAiGatewayRuntime();
    await deleteVaultRecord('runtime-user');
  });

  it('registers the runtime while unlocked and unregisters on lock', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => createElement(AiVaultProvider, null, children);
    const { result } = renderHook(() => useAiVault(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(() => getAiGatewayRuntime()).toThrow(AiGatewayError);

    await act(() => result.current.createVault('vault-pass-123', settings));
    await waitFor(() => expect(getAiGatewayRuntime().settings).toEqual(settings));

    act(() => result.current.lock());
    await waitFor(() => expect(() => getAiGatewayRuntime()).toThrow(AiGatewayError));
  });
});
