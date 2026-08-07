import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  detectLegacyResearchConfig,
  migrateLegacyResearchConfig,
  type LegacyMigrationActions,
} from './legacy-config-migration';
import type { AiAgentSettings, AiSecretDescriptor } from './types';

const baseSettings: AiAgentSettings = {
  defaultProfile: {
    providerId: 'ollama', model: 'qwen2.5:14b',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    temperature: 0.2, maxOutputTokens: 2_000,
  },
  featureOverrides: {}, connectionStatuses: {}, updatedAt: '2026-08-07T00:00:00.000Z',
};

function actions(): LegacyMigrationActions & {
  currentSettings: AiAgentSettings;
  descriptors: AiSecretDescriptor[];
} {
  const state = {
    currentSettings: baseSettings,
    descriptors: [] as AiSecretDescriptor[],
    setSecret: vi.fn(async (id: string, providerId: AiSecretDescriptor['providerId'], value: string) => {
      state.descriptors = [{ id, providerId, lastFour: value.slice(-4) }];
    }),
    saveSettings: vi.fn(async (settings: AiAgentSettings) => { state.currentSettings = settings; }),
    getSnapshot: () => ({ settings: state.currentSettings, secretDescriptors: state.descriptors }),
  };
  return state;
}

describe('legacy research configuration migration', () => {
  beforeEach(() => localStorage.clear());

  it('distinguishes missing and malformed legacy values without deleting them', () => {
    expect(detectLegacyResearchConfig()).toEqual({ status: 'not_found' });
    localStorage.setItem('dd-research-config', '{bad json');
    expect(detectLegacyResearchConfig()).toEqual({ status: 'invalid' });
    expect(localStorage.getItem('dd-research-config')).toBe('{bad json');
  });

  it('returns only a safe preview for valid legacy configuration', () => {
    localStorage.setItem('dd-research-config', JSON.stringify({
      provider: 'deepseek', apiKey: 'sk-sensitive-1234',
      endpoint: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat',
    }));

    expect(detectLegacyResearchConfig()).toEqual({
      status: 'found',
      preview: {
        providerId: 'deepseek', model: 'deepseek-chat',
        endpoint: 'https://api.deepseek.com/v1/chat/completions',
        hasKey: true, keyLastFour: '1234',
      },
    });
    expect(JSON.stringify(detectLegacyResearchConfig())).not.toContain('sk-sensitive');
  });

  it('writes, verifies and only then deletes the legacy value', async () => {
    localStorage.setItem('dd-research-config', JSON.stringify({
      provider: 'openai', apiKey: 'sk-sensitive-5678',
      endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini',
    }));
    const vault = actions();

    await expect(migrateLegacyResearchConfig(vault)).resolves.toMatchObject({ status: 'migrated' });
    expect(vault.setSecret).toHaveBeenCalledWith('default:openai', 'openai', 'sk-sensitive-5678');
    expect(vault.currentSettings.defaultProfile).toMatchObject({
      providerId: 'openai', model: 'gpt-4o-mini', secretId: 'default:openai',
    });
    expect(localStorage.getItem('dd-research-config')).toBeNull();
  });

  it('retains the old value when save or verification fails', async () => {
    const raw = JSON.stringify({ provider: 'deepseek', apiKey: 'sk-sensitive-1234' });
    localStorage.setItem('dd-research-config', raw);
    const vault = actions();
    vault.saveSettings = vi.fn(async () => { throw new Error('save failed'); });
    await expect(migrateLegacyResearchConfig(vault)).rejects.toThrow('save failed');
    expect(localStorage.getItem('dd-research-config')).toBe(raw);

    vault.saveSettings = vi.fn(async () => undefined);
    await expect(migrateLegacyResearchConfig(vault)).rejects.toThrow('旧配置迁移核验失败');
    expect(localStorage.getItem('dd-research-config')).toBe(raw);
  });

  it('is idempotent after success', async () => {
    localStorage.setItem('dd-research-config', JSON.stringify({ provider: 'ollama' }));
    const vault = actions();
    await migrateLegacyResearchConfig(vault);
    await expect(migrateLegacyResearchConfig(vault)).resolves.toEqual({ status: 'not_found' });
  });
});
