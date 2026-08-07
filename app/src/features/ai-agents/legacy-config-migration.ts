import { AI_PROVIDER_PRESETS } from './provider-presets';
import type { AiAgentSettings, AiProviderId, AiSecretDescriptor } from './types';

const STORAGE_KEY = 'dd-research-config';
const LEGACY_PROVIDERS = new Set<AiProviderId>(['ollama', 'openai', 'deepseek', 'kimi', 'custom']);

interface ParsedLegacyConfig {
  providerId: AiProviderId;
  apiKey: string;
  endpoint: string;
  model: string;
}

export interface LegacyConfigPreview {
  providerId: AiProviderId;
  model: string;
  endpoint: string;
  hasKey: boolean;
  keyLastFour: string | null;
}

export type LegacyDetectionResult =
  | { status: 'not_found' }
  | { status: 'invalid' }
  | { status: 'found'; preview: LegacyConfigPreview };

export interface LegacyMigrationActions {
  setSecret(secretId: string, providerId: AiProviderId, value: string): Promise<void>;
  saveSettings(settings: AiAgentSettings): Promise<void>;
  getSnapshot(): { settings: AiAgentSettings; secretDescriptors: AiSecretDescriptor[] } | null;
}

function parseLegacy(storage: Storage): ParsedLegacyConfig | null | 'not_found' {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return 'not_found';

  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.provider !== 'string' || !LEGACY_PROVIDERS.has(record.provider as AiProviderId)) return null;
  for (const field of ['apiKey', 'endpoint', 'model'] as const) {
    if (record[field] !== undefined && typeof record[field] !== 'string') return null;
  }

  const providerId = record.provider as AiProviderId;
  const preset = AI_PROVIDER_PRESETS[providerId];
  return {
    providerId,
    apiKey: (record.apiKey as string | undefined) ?? '',
    endpoint: (record.endpoint as string | undefined) || preset.endpoint,
    model: (record.model as string | undefined) || preset.defaultModel,
  };
}

function preview(config: ParsedLegacyConfig): LegacyConfigPreview {
  return {
    providerId: config.providerId,
    model: config.model,
    endpoint: config.endpoint,
    hasKey: config.apiKey.length > 0,
    keyLastFour: config.apiKey ? config.apiKey.slice(-4) : null,
  };
}

export function detectLegacyResearchConfig(storage: Storage = localStorage): LegacyDetectionResult {
  const parsed = parseLegacy(storage);
  if (parsed === 'not_found') return { status: 'not_found' };
  if (parsed === null) return { status: 'invalid' };
  return { status: 'found', preview: preview(parsed) };
}

export async function migrateLegacyResearchConfig(
  actions: LegacyMigrationActions,
  storage: Storage = localStorage,
): Promise<{ status: 'not_found' | 'invalid' | 'migrated'; preview?: LegacyConfigPreview }> {
  const parsed = parseLegacy(storage);
  if (parsed === 'not_found') return { status: 'not_found' };
  if (parsed === null) return { status: 'invalid' };

  const before = actions.getSnapshot();
  if (!before) throw new Error('请先解锁本机 AI 密钥库');
  const secretId = `default:${parsed.providerId}`;
  const needsKey = AI_PROVIDER_PRESETS[parsed.providerId].needsKey;
  if (parsed.apiKey) await actions.setSecret(secretId, parsed.providerId, parsed.apiKey);

  const nextSettings: AiAgentSettings = {
    ...before.settings,
    defaultProfile: {
      providerId: parsed.providerId,
      model: parsed.model,
      endpoint: parsed.endpoint,
      temperature: 0.3,
      maxOutputTokens: 2_000,
      secretId: needsKey && parsed.apiKey ? secretId : undefined,
    },
    updatedAt: new Date().toISOString(),
  };
  await actions.saveSettings(nextSettings);

  const after = actions.getSnapshot();
  const profileMatches = after?.settings.defaultProfile.providerId === parsed.providerId
    && after.settings.defaultProfile.model === parsed.model
    && after.settings.defaultProfile.endpoint === parsed.endpoint;
  const descriptorMatches = !parsed.apiKey || after?.secretDescriptors.some(
    (item) => item.id === secretId && item.providerId === parsed.providerId && item.lastFour === parsed.apiKey.slice(-4),
  );
  if (!profileMatches || !descriptorMatches) throw new Error('旧配置迁移核验失败，原配置已保留');

  storage.removeItem(STORAGE_KEY);
  return { status: 'migrated', preview: preview(parsed) };
}
