import { describe, expect, it } from 'vitest';

import {
  createVaultKdfConfig,
  decryptVaultPayload,
  deriveVaultKey,
  encryptVaultPayload,
  validateVaultPassword,
} from './vault-crypto';

describe('AI vault crypto', () => {
  it('round-trips plaintext with the correct password', async () => {
    const kdf = createVaultKdfConfig();
    const key = await deriveVaultKey('vault-pass-123', kdf);
    const encrypted = await encryptVaultPayload(key, 'sk-sensitive-value');

    await expect(decryptVaultPayload(key, encrypted)).resolves.toBe('sk-sensitive-value');
  });

  it('maps a wrong password to a stable error', async () => {
    const kdf = createVaultKdfConfig();
    const correctKey = await deriveVaultKey('vault-pass-123', kdf);
    const wrongKey = await deriveVaultKey('vault-pass-456', kdf);
    const encrypted = await encryptVaultPayload(correctKey, 'secret');

    await expect(decryptVaultPayload(wrongKey, encrypted)).rejects.toThrow('密钥库密码错误');
  });

  it('uses a fresh IV for each encryption', async () => {
    const kdf = createVaultKdfConfig();
    const key = await deriveVaultKey('vault-pass-123', kdf);
    const first = await encryptVaultPayload(key, 'same payload');
    const second = await encryptVaultPayload(key, 'same payload');

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('does not include plaintext in the serialized envelope', async () => {
    const kdf = createVaultKdfConfig();
    const key = await deriveVaultKey('vault-pass-123', kdf);
    const encrypted = await encryptVaultPayload(key, 'sk-sensitive-value');

    expect(JSON.stringify(encrypted)).not.toContain('sk-sensitive-value');
  });

  it('requires at least ten password characters', () => {
    expect(() => validateVaultPassword('123456789')).toThrow('密钥库密码至少需要 10 位');
    expect(() => validateVaultPassword('1234567890')).not.toThrow();
  });
});
