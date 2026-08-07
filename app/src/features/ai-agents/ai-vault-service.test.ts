import { beforeEach, describe, expect, it } from 'vitest';

import { deleteVaultRecord, getVaultRecord, hasAiVault } from './ai-vault-db';
import {
  changeAiVaultPassword,
  clearAiVault,
  createAiVault,
  saveAiVault,
  unlockAiVault,
} from './ai-vault-service';
import type { AiAgentSettings } from './types';

const settings: AiAgentSettings = {
  defaultProfile: {
    providerId: 'deepseek',
    model: 'deepseek-chat',
    endpoint: 'https://api.deepseek.com/chat/completions',
    temperature: 0.2,
    maxOutputTokens: 2_000,
    secretId: 'default:deepseek',
  },
  featureOverrides: {},
  connectionStatuses: {},
  updatedAt: '2026-08-07T00:00:00.000Z',
};

describe('AI vault service', () => {
  beforeEach(async () => {
    await Promise.all(['user-a', 'user-b'].map(deleteVaultRecord));
  });

  it('creates isolated namespaces and unlocks an empty vault', async () => {
    await createAiVault('user-a', 'vault-pass-123', settings);

    await expect(hasAiVault('user-a')).resolves.toBe(true);
    await expect(hasAiVault('user-b')).resolves.toBe(false);

    const unlocked = await unlockAiVault('user-a', 'vault-pass-123');
    expect(unlocked.settings).toEqual(settings);
    expect(unlocked.secrets).toEqual({});
  });

  it('encrypts secret values before persistence', async () => {
    const unlocked = await createAiVault('user-a', 'vault-pass-123', settings);
    await saveAiVault({
      ...unlocked,
      secrets: { 'default:deepseek': 'sk-sensitive-value' },
      secretDescriptors: [
        { id: 'default:deepseek', providerId: 'deepseek', lastFour: 'alue' },
      ],
    });

    const raw = await getVaultRecord('user-a');
    expect(JSON.stringify(raw)).not.toContain('sk-sensitive-value');

    const reopened = await unlockAiVault('user-a', 'vault-pass-123');
    expect(reopened.secrets['default:deepseek']).toBe('sk-sensitive-value');
  });

  it('changes password by re-encrypting the vault', async () => {
    const unlocked = await createAiVault('user-a', 'vault-pass-123', settings);
    await saveAiVault({ ...unlocked, secrets: { key: 'secret-value' } });

    await changeAiVaultPassword('user-a', 'vault-pass-123', 'new-vault-pass-456');

    await expect(unlockAiVault('user-a', 'vault-pass-123')).rejects.toThrow(
      '密钥库密码错误',
    );
    await expect(unlockAiVault('user-a', 'new-vault-pass-456')).resolves.toMatchObject({
      secrets: { key: 'secret-value' },
    });
  });

  it('clears only the requested namespace', async () => {
    await createAiVault('user-a', 'vault-pass-123', settings);
    await createAiVault('user-b', 'vault-pass-123', settings);

    await clearAiVault('user-a');

    await expect(hasAiVault('user-a')).resolves.toBe(false);
    await expect(hasAiVault('user-b')).resolves.toBe(true);
  });
});
