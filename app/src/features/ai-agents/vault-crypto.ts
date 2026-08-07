export interface EncryptedPayload {
  algorithmVersion: 1;
  iv: string;
  ciphertext: string;
}

export interface VaultKdfConfig {
  algorithm: 'PBKDF2-SHA256';
  iterations: 310000;
  salt: string;
}

const MINIMUM_PASSWORD_LENGTH = 10;
const KDF_ITERATIONS = 310_000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function validateVaultPassword(password: string): void {
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    throw new Error('密钥库密码至少需要 10 位');
  }
}

export function createVaultKdfConfig(): VaultKdfConfig {
  const salt = crypto.getRandomValues(new Uint8Array(16));

  return {
    algorithm: 'PBKDF2-SHA256',
    iterations: KDF_ITERATIONS,
    salt: bytesToBase64(salt),
  };
}

export async function deriveVaultKey(
  password: string,
  config: VaultKdfConfig,
): Promise<CryptoKey> {
  const passwordMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: config.iterations,
      salt: toArrayBuffer(base64ToBytes(config.salt)),
    },
    passwordMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptVaultPayload(
  key: CryptoKey,
  plaintext: string,
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(encoded),
  );

  return {
    algorithmVersion: 1,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptVaultPayload(
  key: CryptoKey,
  payload: EncryptedPayload,
): Promise<string> {
  if (payload.algorithmVersion !== 1) {
    throw new Error('不支持的密钥库加密版本');
  }

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(payload.iv)) },
      key,
      toArrayBuffer(base64ToBytes(payload.ciphertext)),
    );

    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error('密钥库密码错误');
  }
}
