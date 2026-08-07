import Dexie, { type EntityTable } from 'dexie';

import type { AiAgentSettings, AiSecretDescriptor } from './types';
import type { EncryptedPayload, VaultKdfConfig } from './vault-crypto';

export interface AiVaultRecord {
  namespace: string;
  version: 1;
  kdf: VaultKdfConfig;
  verifier: EncryptedPayload;
  encryptedSecrets: EncryptedPayload;
  settings: AiAgentSettings;
  secretDescriptors: AiSecretDescriptor[];
  updatedAt: string;
}

export class AiVaultDatabase extends Dexie {
  vaults!: EntityTable<AiVaultRecord, 'namespace'>;

  constructor() {
    super('investment-dd-ai-vault');
    this.version(1).stores({
      vaults: '&namespace, updatedAt',
    });
  }
}

const database = new AiVaultDatabase();

export async function getVaultRecord(namespace: string): Promise<AiVaultRecord | undefined> {
  return database.vaults.get(namespace);
}

export async function hasAiVault(namespace: string): Promise<boolean> {
  return (await database.vaults.get(namespace)) !== undefined;
}

export async function putVaultRecord(record: AiVaultRecord): Promise<void> {
  await database.transaction('rw', database.vaults, async () => {
    await database.vaults.put(record);
  });
}

export async function deleteVaultRecord(namespace: string): Promise<void> {
  await database.vaults.delete(namespace);
}
