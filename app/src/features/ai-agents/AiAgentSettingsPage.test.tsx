import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentSettingsPage } from './AiAgentSettingsPage';
import type { AiAgentSettings, AiProviderId } from './types';
import type { AiVaultContextValue } from './useAiVault';

const mocks = vi.hoisted(() => ({
  vault: null as AiVaultContextValue | null,
}));

vi.mock('./useAiVault', () => ({ useAiVault: () => mocks.vault }));
vi.mock('./ai-gateway', () => ({
  testAiConnection: vi.fn(async () => ({
    content: 'OK', providerId: 'deepseek', model: 'deepseek-chat', latencyMs: 42,
    inputTokens: 2, outputTokens: 1, finishReason: 'stop',
  })),
}));

function baseVault(overrides: Partial<AiVaultContextValue> = {}): AiVaultContextValue {
  return {
    namespace: 'user-a', exists: false, locked: true, loading: false, retryAfter: null,
    settings: null, secretDescriptors: [], createVault: vi.fn(), unlock: vi.fn(), lock: vi.fn(),
    saveSettings: vi.fn(), setSecret: vi.fn(), removeSecret: vi.fn(),
    changePassword: vi.fn(), clearVault: vi.fn(), resolveSecret: vi.fn(() => null),
    getSnapshot: vi.fn(() => null),
    ...overrides,
  };
}

describe('AiAgentSettingsPage', () => {
  beforeEach(() => {
    mocks.vault = baseVault();
  });

  it('shows vault creation when no local vault exists', () => {
    render(<MemoryRouter><AiAgentSettingsPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: '本机 AI 密钥库' })).toBeInTheDocument();
    expect(screen.getByLabelText('密钥库密码')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('确认密钥库密码')).toBeInTheDocument();
  });

  it('shows unlock state and retry information for an existing locked vault', () => {
    mocks.vault = baseVault({ exists: true, retryAfter: Date.now() + 30_000 });
    render(<MemoryRouter><AiAgentSettingsPage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: '解锁密钥库' })).toBeDisabled();
    expect(screen.getByText(/尝试次数过多/)).toBeInTheDocument();
  });

  it('shows default and two feature sections without revealing saved Keys', () => {
    mocks.vault = baseVault({
      exists: true,
      locked: false,
      settings: {
        defaultProfile: {
          providerId: 'deepseek', model: 'deepseek-chat',
          endpoint: 'https://api.deepseek.com/chat/completions',
          temperature: 0.2, maxOutputTokens: 2000, secretId: 'default:deepseek',
        },
        featureOverrides: {}, connectionStatuses: {}, updatedAt: '2026-08-07T00:00:00.000Z',
      },
      secretDescriptors: [
        { id: 'default:deepseek', providerId: 'deepseek', lastFour: '1234' },
      ],
    });
    render(<MemoryRouter><AiAgentSettingsPage /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: '全站默认模型' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '投研尽调 AI' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '证券分析 AI' })).toBeInTheDocument();
    expect(screen.getByText('•••• 1234')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /显示.*Key/ })).not.toBeInTheDocument();
  });

  it('requires the exact confirmation phrase before clearing', () => {
    mocks.vault = baseVault({ exists: true, locked: false, settings: {
      defaultProfile: { providerId: 'ollama', model: 'qwen2.5:14b', endpoint: 'http://localhost:11434/v1/chat/completions', temperature: 0.2, maxOutputTokens: 2000 },
      featureOverrides: {}, connectionStatuses: {}, updatedAt: '2026-08-07T00:00:00.000Z',
    } });
    render(<MemoryRouter><AiAgentSettingsPage /></MemoryRouter>);
    const clearButton = screen.getByRole('button', { name: '确认清空密钥库' });
    expect(clearButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('清空确认'), { target: { value: '清空密钥库' } });
    expect(clearButton).toBeEnabled();
  });
});

describe('AiAgentSettingsPage legacy migration panel', () => {
  const legacyRaw = JSON.stringify({
    provider: 'deepseek', apiKey: 'sk-legacy-1234',
    endpoint: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat',
  });

  function unlockedVaultWithState() {
    const state = {
      settings: {
        defaultProfile: {
          providerId: 'ollama', model: 'qwen2.5:14b',
          endpoint: 'http://localhost:11434/v1/chat/completions',
          temperature: 0.2, maxOutputTokens: 2000,
        },
        featureOverrides: {}, connectionStatuses: {}, updatedAt: '2026-08-07T00:00:00.000Z',
      } as AiAgentSettings,
      descriptors: [] as { id: string; providerId: AiProviderId; lastFour: string }[],
    };
    const vault = baseVault({
      exists: true,
      locked: false,
      settings: state.settings,
      setSecret: vi.fn(async (id: string, providerId: AiProviderId, value: string) => {
        state.descriptors = [{ id, providerId, lastFour: value.slice(-4) }];
      }),
      saveSettings: vi.fn(async (settings: AiAgentSettings) => { state.settings = settings; }),
      getSnapshot: () => ({ settings: state.settings, secretDescriptors: state.descriptors }),
    });
    return { vault, state };
  }

  beforeEach(() => {
    localStorage.clear();
  });

  it('hides the panel when no legacy config exists', () => {
    mocks.vault = unlockedVaultWithState().vault;
    render(<MemoryRouter><AiAgentSettingsPage /></MemoryRouter>);
    expect(screen.queryByRole('heading', { name: '发现旧版研究配置' })).not.toBeInTheDocument();
  });

  it('shows provider, model, endpoint and masked key, requiring explicit confirmation', () => {
    localStorage.setItem('dd-research-config', legacyRaw);
    mocks.vault = unlockedVaultWithState().vault;
    render(<MemoryRouter><AiAgentSettingsPage /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: '发现旧版研究配置' })).toBeInTheDocument();
    expect(screen.getByText('deepseek-chat')).toBeInTheDocument();
    expect(screen.getByText('https://api.deepseek.com/v1/chat/completions')).toBeInTheDocument();
    expect(screen.getByText('已保存 Key：•••• 1234')).toBeInTheDocument();
    expect(screen.queryByText(/sk-legacy/)).not.toBeInTheDocument();

    const importButton = screen.getByRole('button', { name: '导入旧配置' });
    expect(importButton).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /我确认导入到当前账户的本机密钥库/ }));
    expect(importButton).toBeEnabled();
  });

  it('imports through the encrypted vault and deletes the legacy value only after verification', async () => {
    localStorage.setItem('dd-research-config', legacyRaw);
    const { vault, state } = unlockedVaultWithState();
    mocks.vault = vault;
    render(<MemoryRouter><AiAgentSettingsPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole('checkbox', { name: /我确认导入到当前账户的本机密钥库/ }));
    fireEvent.click(screen.getByRole('button', { name: '导入旧配置' }));

    await waitFor(() => expect(localStorage.getItem('dd-research-config')).toBeNull());
    expect(vault.setSecret).toHaveBeenCalledWith('default:deepseek', 'deepseek', 'sk-legacy-1234');
    expect(state.settings.defaultProfile).toMatchObject({
      providerId: 'deepseek', model: 'deepseek-chat', secretId: 'default:deepseek',
    });
    await waitFor(() => expect(screen.queryByRole('heading', { name: '发现旧版研究配置' })).not.toBeInTheDocument());
  });

  it('retains the legacy value when the encrypted save fails', async () => {
    localStorage.setItem('dd-research-config', legacyRaw);
    const { vault } = unlockedVaultWithState();
    vault.saveSettings = vi.fn(async () => { throw new Error('save failed'); });
    mocks.vault = vault;
    render(<MemoryRouter><AiAgentSettingsPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole('checkbox', { name: /我确认导入到当前账户的本机密钥库/ }));
    fireEvent.click(screen.getByRole('button', { name: '导入旧配置' }));

    await waitFor(() => expect(screen.getByText('save failed')).toBeInTheDocument());
    expect(localStorage.getItem('dd-research-config')).toBe(legacyRaw);
    expect(screen.getByRole('heading', { name: '发现旧版研究配置' })).toBeInTheDocument();
  });
});
