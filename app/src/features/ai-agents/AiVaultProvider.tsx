import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { hasAiVault } from './ai-vault-db';
import {
  changeAiVaultPassword,
  clearAiVault,
  createAiVault,
  saveAiVault,
  unlockAiVault,
  type UnlockedAiVault,
} from './ai-vault-service';
import type { AiAgentSettings, AiProviderId, AiSecretDescriptor } from './types';
import { AiVaultContext, type AiVaultContextValue } from './useAiVault';

const BACKGROUND_LOCK_DELAY_MS = 30 * 60 * 1_000;
const FAILED_UNLOCK_LIMIT = 5;
const RETRY_DELAY_MS = 30 * 1_000;

export function resolveVaultNamespace(
  userId: string | null | undefined,
  options: { allowGuest?: boolean } = {},
): string | null {
  if (userId) return userId;
  return options.allowGuest ? 'local-guest' : null;
}

export function AiVaultProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const namespace = resolveVaultNamespace(auth.user?.id);
  const [exists, setExists] = useState(false);
  const [locked, setLocked] = useState(true);
  const [loading, setLoading] = useState(true);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [settings, setSettings] = useState<AiAgentSettings | null>(null);
  const [secretDescriptors, setSecretDescriptors] = useState<AiSecretDescriptor[]>([]);
  const keyRef = useRef<CryptoKey | null>(null);
  const secretsRef = useRef<Record<string, string>>({});
  const settingsRef = useRef<AiAgentSettings | null>(null);
  const descriptorsRef = useRef<AiSecretDescriptor[]>([]);
  const lockedRef = useRef(true);
  const failedUnlocksRef = useRef(0);
  const hiddenAtRef = useRef<number | null>(null);

  const lock = useCallback(() => {
    keyRef.current = null;
    secretsRef.current = {};
    settingsRef.current = null;
    descriptorsRef.current = [];
    lockedRef.current = true;
    setLocked(true);
    setSettings(null);
    setSecretDescriptors([]);
  }, []);

  const applyUnlocked = useCallback((vault: UnlockedAiVault) => {
    keyRef.current = vault.key;
    secretsRef.current = { ...vault.secrets };
    settingsRef.current = vault.settings;
    descriptorsRef.current = [...vault.secretDescriptors];
    lockedRef.current = false;
    setLocked(false);
    setSettings(vault.settings);
    setSecretDescriptors(vault.secretDescriptors);
  }, []);

  useEffect(() => {
    let active = true;
    lock();
    failedUnlocksRef.current = 0;
    setRetryAfter(null);

    if (auth.loading) {
      setLoading(true);
      return () => { active = false; };
    }
    if (!namespace) {
      setExists(false);
      setLoading(false);
      return () => { active = false; };
    }

    setLoading(true);
    void hasAiVault(namespace).then((found) => {
      if (!active) return;
      setExists(found);
      setLoading(false);
    });
    return () => { active = false; };
  }, [auth.loading, lock, namespace]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
        return;
      }
      if (hiddenAtRef.current !== null && Date.now() - hiddenAtRef.current >= BACKGROUND_LOCK_DELAY_MS) {
        lock();
      }
      hiddenAtRef.current = null;
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [lock]);

  const requireNamespace = useCallback((): string => {
    if (!namespace) throw new Error('请先登录后再使用本机 AI 密钥库');
    return namespace;
  }, [namespace]);

  const currentVault = useCallback((): UnlockedAiVault => {
    if (lockedRef.current || !keyRef.current || !settingsRef.current) {
      throw new Error('本机 AI 密钥库已锁定');
    }
    return {
      namespace: requireNamespace(),
      key: keyRef.current,
      settings: settingsRef.current,
      secrets: secretsRef.current,
      secretDescriptors: descriptorsRef.current,
    };
  }, [requireNamespace]);

  const createVault = useCallback(async (password: string, initialSettings: AiAgentSettings) => {
    const vault = await createAiVault(requireNamespace(), password, initialSettings);
    applyUnlocked(vault);
    setExists(true);
    failedUnlocksRef.current = 0;
    setRetryAfter(null);
  }, [applyUnlocked, requireNamespace]);

  const unlock = useCallback(async (password: string) => {
    if (retryAfter !== null && Date.now() < retryAfter) {
      throw new Error('尝试次数过多，请稍后再试');
    }
    try {
      const vault = await unlockAiVault(requireNamespace(), password);
      applyUnlocked(vault);
      failedUnlocksRef.current = 0;
      setRetryAfter(null);
    } catch (error) {
      failedUnlocksRef.current += 1;
      if (failedUnlocksRef.current >= FAILED_UNLOCK_LIMIT) {
        setRetryAfter(Date.now() + RETRY_DELAY_MS);
      }
      throw error;
    }
  }, [applyUnlocked, requireNamespace, retryAfter]);

  const persistVault = useCallback(async (vault: UnlockedAiVault) => {
    await saveAiVault(vault);
    applyUnlocked(vault);
  }, [applyUnlocked]);

  const saveSettings = useCallback(async (nextSettings: AiAgentSettings) => {
    await persistVault({ ...currentVault(), settings: nextSettings });
  }, [currentVault, persistVault]);

  const setSecret = useCallback(async (secretId: string, providerId: AiProviderId, value: string) => {
    const vault = currentVault();
    const descriptor = { id: secretId, providerId, lastFour: value.slice(-4) };
    await persistVault({
      ...vault,
      secrets: { ...vault.secrets, [secretId]: value },
      secretDescriptors: [
        ...vault.secretDescriptors.filter((item) => item.id !== secretId),
        descriptor,
      ],
    });
  }, [currentVault, persistVault]);

  const removeSecret = useCallback(async (secretId: string) => {
    const vault = currentVault();
    const nextSecrets = { ...vault.secrets };
    delete nextSecrets[secretId];
    await persistVault({
      ...vault,
      secrets: nextSecrets,
      secretDescriptors: vault.secretDescriptors.filter((item) => item.id !== secretId),
    });
  }, [currentVault, persistVault]);

  const changePassword = useCallback(async (oldPassword: string, newPassword: string) => {
    const vault = await changeAiVaultPassword(requireNamespace(), oldPassword, newPassword);
    applyUnlocked(vault);
    failedUnlocksRef.current = 0;
    setRetryAfter(null);
  }, [applyUnlocked, requireNamespace]);

  const clearVault = useCallback(async () => {
    await clearAiVault(requireNamespace());
    lock();
    setExists(false);
    failedUnlocksRef.current = 0;
    setRetryAfter(null);
  }, [lock, requireNamespace]);

  const resolveSecret = useCallback((secretId: string): string | null => {
    if (lockedRef.current) return null;
    return secretsRef.current[secretId] ?? null;
  }, []);
  const getSnapshot = useCallback(() => {
    if (lockedRef.current || !settingsRef.current) return null;
    return { settings: settingsRef.current, secretDescriptors: [...descriptorsRef.current] };
  }, []);


  const value = useMemo<AiVaultContextValue>(() => ({
    namespace, exists, locked, loading, retryAfter, settings, secretDescriptors,
    createVault, unlock, lock, saveSettings, setSecret, removeSecret,
    changePassword, clearVault, resolveSecret, getSnapshot,
  }), [namespace, exists, locked, loading, retryAfter, settings, secretDescriptors,
    createVault, unlock, lock, saveSettings, setSecret, removeSecret,
    changePassword, clearVault, resolveSecret, getSnapshot]);

  return <AiVaultContext.Provider value={value}>{children}</AiVaultContext.Provider>;
}
