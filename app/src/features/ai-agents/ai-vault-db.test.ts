import { beforeEach, describe, expect, it } from 'vitest';

import {
  deleteVaultRecord,
  getVaultRecord,
  hasAiVault,
  putVaultRecord,
} from './ai-vault-db';
import type { AiVaultRecord } from './ai-vault-db';

const record: AiVaultRecord = {
  namespace: 'db-test-user',
  version: 1,
  kdf: { algorithm: 'PBKDF2-SHA256', iterations: 310_000, salt: 'salt' },
  verifier: { algorithmVersion: 1, iv: 'iv-a', ciphertext: 'cipher-a' },
  encryptedSecrets: { algorithmVersion: 1, iv: 'iv-b', ciphertext: 'cipher-b' },
  settings: {
    defaultProfile: {
      providerId: 'openai',
      model: 'gpt-4o-mini',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      temperature: 0.2,
      maxOutputTokens: 2_000,
    },
    featureOverrides: {},
    connectionStatuses: {},
    updatedAt: '2026-08-07T00:00:00.000Z',
  },
  secretDescriptors: [],
  updatedAt: '2026-08-07T00:00:00.000Z',
};

describe('AI vault database', () => {
  beforeEach(async () => {
    await deleteVaultRecord(record.namespace);
  });

  it('stores, reads and deletes an exact namespace', async () => {
    await putVaultRecord(record);

    await expect(hasAiVault(record.namespace)).resolves.toBe(true);
    await expect(getVaultRecord(record.namespace)).resolves.toEqual(record);

    await deleteVaultRecord(record.namespace);
    await expect(hasAiVault(record.namespace)).resolves.toBe(false);
  });
});
