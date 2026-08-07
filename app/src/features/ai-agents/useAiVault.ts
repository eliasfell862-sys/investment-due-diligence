import { createContext, useContext } from 'react';

import type { AiAgentSettings, AiProviderId, AiSecretDescriptor } from './types';

export interface AiVaultContextValue {
  namespace: string | null;
  exists: boolean;
  locked: boolean;
  loading: boolean;
  retryAfter: number | null;
  settings: AiAgentSettings | null;
  secretDescriptors: AiSecretDescriptor[];
  createVault(password: string, settings: AiAgentSettings): Promise<void>;
  unlock(password: string): Promise<void>;
  lock(): void;
  saveSettings(settings: AiAgentSettings): Promise<void>;
  setSecret(secretId: string, providerId: AiProviderId, value: string): Promise<void>;
  removeSecret(secretId: string): Promise<void>;
  changePassword(oldPassword: string, newPassword: string): Promise<void>;
  clearVault(): Promise<void>;
  resolveSecret(secretId: string): string | null;
}

export const AiVaultContext = createContext<AiVaultContextValue | null>(null);

export function useAiVault(): AiVaultContextValue {
  const value = useContext(AiVaultContext);
  if (!value) throw new Error('useAiVault must be used within AiVaultProvider');
  return value;
}
