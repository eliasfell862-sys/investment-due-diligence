import {
  deleteVaultRecord,
  getVaultRecord,
  hasAiVault,
  putVaultRecord,
} from './ai-vault-db';
import type { AiVaultRecord } from './ai-vault-db';
import type { AiAgentSettings, AiSecretDescriptor } from './types';
import {
  createVaultKdfConfig,
  decryptVaultPayload,
  deriveVaultKey,
  encryptVaultPayload,
  validateVaultPassword,
} from './vault-crypto';

const VAULT_VERIFIER = 'investment-dd-ai-vault-v1';

export interface UnlockedAiVault {
  namespace: string;
  key: CryptoKey;
  settings: AiAgentSettings;
  secrets: Record<string, string>;
  secretDescriptors: AiSecretDescriptor[];
}

function parseSecrets(value: string): Record<string, string> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('密钥库数据损坏');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((secret) => typeof secret !== 'string')
  ) {
    throw new Error('密钥库数据损坏');
  }

  return parsed as Record<string, string>;
}

async function buildRecord(
  vault: UnlockedAiVault,
  base: Pick<AiVaultRecord, 'kdf' | 'verifier'>,
): Promise<AiVaultRecord> {
  return {
    namespace: vault.namespace,
    version: 1,
    kdf: base.kdf,
    verifier: base.verifier,
    encryptedSecrets: await encryptVaultPayload(vault.key, JSON.stringify(vault.secrets)),
    settings: vault.settings,
    secretDescriptors: vault.secretDescriptors,
    updatedAt: new Date().toISOString(),
  };
}

export async function createAiVault(
  namespace: string,
  password: string,
  settings: AiAgentSettings,
): Promise<UnlockedAiVault> {
  validateVaultPassword(password);

  if (await hasAiVault(namespace)) {
    throw new Error('当前账户的本机密钥库已存在');
  }

  const kdf = createVaultKdfConfig();
  const key = await deriveVaultKey(password, kdf);
  const verifier = await encryptVaultPayload(key, VAULT_VERIFIER);
  const vault: UnlockedAiVault = {
    namespace,
    key,
    settings,
    secrets: {},
    secretDescriptors: [],
  };

  await putVaultRecord(await buildRecord(vault, { kdf, verifier }));
  return vault;
}

export async function unlockAiVault(
  namespace: string,
  password: string,
): Promise<UnlockedAiVault> {
  const record = await getVaultRecord(namespace);
  if (!record) {
    throw new Error('当前账户尚未创建本机密钥库');
  }

  const key = await deriveVaultKey(password, record.kdf);
  const verifier = await decryptVaultPayload(key, record.verifier);
  if (verifier !== VAULT_VERIFIER) {
    throw new Error('密钥库密码错误');
  }

  const secrets = parseSecrets(await decryptVaultPayload(key, record.encryptedSecrets));
  return {
    namespace,
    key,
    settings: record.settings,
    secrets,
    secretDescriptors: record.secretDescriptors,
  };
}

export async function saveAiVault(vault: UnlockedAiVault): Promise<UnlockedAiVault> {
  const record = await getVaultRecord(vault.namespace);
  if (!record) {
    throw new Error('当前账户尚未创建本机密钥库');
  }

  await putVaultRecord(await buildRecord(vault, record));
  return vault;
}

export async function changeAiVaultPassword(
  namespace: string,
  oldPassword: string,
  newPassword: string,
): Promise<UnlockedAiVault> {
  validateVaultPassword(newPassword);
  const unlocked = await unlockAiVault(namespace, oldPassword);
  const kdf = createVaultKdfConfig();
  const key = await deriveVaultKey(newPassword, kdf);
  const verifier = await encryptVaultPayload(key, VAULT_VERIFIER);
  const rekeyed: UnlockedAiVault = { ...unlocked, key };

  await putVaultRecord(await buildRecord(rekeyed, { kdf, verifier }));
  return rekeyed;
}

export async function clearAiVault(namespace: string): Promise<void> {
  await deleteVaultRecord(namespace);
}
