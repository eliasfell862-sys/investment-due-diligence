import 'fake-indexeddb/auto';

import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeAiTask } from './ai-gateway';
import { deleteVaultRecord, getVaultRecord } from './ai-vault-db';
import { AiVaultProvider } from './AiVaultProvider';
import { createAiVault, saveAiVault, unlockAiVault } from './ai-vault-service';
import type { AiAgentSettings } from './types';
import { useAiVault } from './useAiVault';

const SENTINEL = 'sk-security-sentinel-20260807';
const NAMESPACE = 'security-audit-user';
const PASSWORD = 'vault-pass-2026';
const SECRET_ID = 'default:deepseek';

const auth = vi.hoisted(() => ({
  user: { id: 'security-audit-user' } as { id: string } | null,
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
    secretId: SECRET_ID,
  },
  featureOverrides: {},
  connectionStatuses: {},
  updatedAt: '2026-08-07T00:00:00.000Z',
};

describe('local AI vault security boundary', () => {
  beforeEach(async () => {
    auth.user = { id: NAMESPACE };
    auth.loading = false;
    localStorage.clear();
    await deleteVaultRecord(NAMESPACE);
  });

  it('never persists, exposes or logs the plaintext Key', async () => {
    const vault = await createAiVault(NAMESPACE, PASSWORD, settings);
    vault.secrets[SECRET_ID] = SENTINEL;
    vault.secretDescriptors.push({ id: SECRET_ID, providerId: 'deepseek', lastFour: SENTINEL.slice(-4) });
    await saveAiVault(vault);

    // 1. IndexedDB 原始记录序列化后不得包含明文
    const record = await getVaultRecord(NAMESPACE);
    expect(record).toBeDefined();
    expect(JSON.stringify(record)).not.toContain(SENTINEL);

    // 2. localStorage 任何值不得包含明文
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      expect(localStorage.getItem(key!)).not.toContain(SENTINEL);
    }

    // 3. 设置和密钥描述对象不得包含明文（只保留尾四位）
    expect(JSON.stringify(record!.settings)).not.toContain(SENTINEL);
    expect(JSON.stringify(record!.secretDescriptors)).not.toContain(SENTINEL);
    expect(record!.secretDescriptors[0]?.lastFour).toBe('0807');

    // 4. 解锁后明文只存在于内存，可用于 Gateway 请求
    const unlocked = await unlockAiVault(NAMESPACE, PASSWORD);
    expect(unlocked.secrets[SECRET_ID]).toBe(SENTINEL);

    const consoleOutput: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => { consoleOutput.push(args.map(String).join(' ')); });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => { consoleOutput.push(args.map(String).join(' ')); });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => { consoleOutput.push(args.map(String).join(' ')); });

    try {
      // 供应商回包甚至回显了 Key，归一化错误也不得带出明文
      const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(
        JSON.stringify({ error: { message: `invalid api key: ${SENTINEL}` } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ));

      const failure = await executeAiTask(
        { taskId: 'due_diligence.research', systemPrompt: 's', userPrompt: 'u' },
        {
          settings: unlocked.settings,
          resolveSecret: (secretId) => unlocked.secrets[secretId] ?? null,
          fetchImpl,
        },
      ).then(
        () => { throw new Error('expected the gateway call to fail'); },
        (error: unknown) => error,
      );

      // 传输层确实携带了 Key（合法），但错误对象不得回显
      const requestInit = fetchImpl.mock.calls[0]?.[1] as RequestInit;
      expect((requestInit.headers as Headers).get('Authorization')).toBe(`Bearer ${SENTINEL}`);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).not.toContain(SENTINEL);
      expect(JSON.stringify(failure)).not.toContain(SENTINEL);

      // 5. 失败过程中的 console 输出不得包含明文
      expect(consoleOutput.join('\n')).not.toContain(SENTINEL);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('locks the provider session and clears plaintext access', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => createElement(AiVaultProvider, null, children);
    const { result } = renderHook(() => useAiVault(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.createVault(PASSWORD, settings));
    await act(() => result.current.setSecret(SECRET_ID, 'deepseek', SENTINEL));
    expect(result.current.resolveSecret(SECRET_ID)).toBe(SENTINEL);

    act(() => result.current.lock());
    expect(result.current.resolveSecret(SECRET_ID)).toBeNull();
    expect(result.current.getSnapshot()).toBeNull();

    // 锁定后落库记录依然是密文
    const record = await getVaultRecord(NAMESPACE);
    expect(JSON.stringify(record)).not.toContain(SENTINEL);
  });
});
