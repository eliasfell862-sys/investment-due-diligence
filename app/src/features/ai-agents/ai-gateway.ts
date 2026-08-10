import { resolveAiModelProfile } from './config-resolution';
import {
  createAiGatewayError,
  executeOpenAiCompatibleRequest,
  type AiFetch,
  type AiTaskResult,
} from './ai-provider-adapter';
import { AI_PROVIDER_PRESETS, validateAiEndpoint } from './provider-presets';
import type { AiAgentSettings, AiModelProfile, AiTaskId } from './types';

export interface AiTaskRequest {
  taskId: AiTaskId;
  systemPrompt: string;
  userPrompt: string;
  responseFormat?: 'text' | 'json';
  timeoutMs?: number;
}

export interface AiGatewayRuntime {
  settings: AiAgentSettings | null;
  resolveSecret(secretId: string): string | null;
  fetchImpl?: AiFetch;
}

function validateProfile(profile: AiModelProfile): void {
  try {
    validateAiEndpoint(profile);
  } catch (error) {
    const message = error instanceof Error ? error.message : undefined;
    throw createAiGatewayError('provider_error', message);
  }
}

/**
 * 归一化 endpoint：
 * - 空值 → 回填 preset 默认端点
 * - 相对路径（旧版走 vite 代理的 /api/xxx/... 格式）→ 换成 preset 完整 URL，
 *   否则 new URL() 解析失败会报"AI Endpoint 格式无效"
 */
function withEffectiveEndpoint(profile: AiModelProfile): AiModelProfile {
  const endpoint = profile.endpoint?.trim() ?? '';
  if (endpoint && !endpoint.startsWith('/')) return profile;
  const preset = AI_PROVIDER_PRESETS[profile.providerId];
  return { ...profile, endpoint: preset.endpoint };
}

function resolveProfileKey(
  profile: AiModelProfile,
  resolveSecret: (secretId: string) => string | null,
): string | null {
  const preset = AI_PROVIDER_PRESETS[profile.providerId];
  if (!preset.needsKey) return null;

  const key = profile.secretId ? resolveSecret(profile.secretId) : null;
  if (!key) throw createAiGatewayError('missing_key');
  return key;
}

export async function executeAiTask(
  request: AiTaskRequest,
  runtime: AiGatewayRuntime,
): Promise<AiTaskResult> {
  if (!runtime.settings) throw createAiGatewayError('vault_locked');

  const { profile } = resolveAiModelProfile(runtime.settings, request.taskId);
  const effective = withEffectiveEndpoint(profile);
  validateProfile(effective);
  const key = resolveProfileKey(effective, runtime.resolveSecret);

  return executeOpenAiCompatibleRequest({
    profile: effective,
    key,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    responseFormat: request.responseFormat,
    timeoutMs: request.timeoutMs,
    fetchImpl: runtime.fetchImpl,
  });
}

export async function testAiConnection(
  profile: AiModelProfile,
  key: string | null,
  fetchImpl: AiFetch = fetch,
): Promise<AiTaskResult> {
  const effective = withEffectiveEndpoint(profile);
  validateProfile(effective);
  const preset = AI_PROVIDER_PRESETS[effective.providerId];
  if (preset.needsKey && !key) throw createAiGatewayError('missing_key');

  return executeOpenAiCompatibleRequest({
    profile: { ...effective, maxOutputTokens: Math.min(effective.maxOutputTokens, 16) },
    key: preset.needsKey ? key : null,
    systemPrompt: 'You are a connection test endpoint.',
    userPrompt: 'Return exactly: OK',
    responseFormat: 'text',
    timeoutMs: 30_000,
    fetchImpl,
  });
}

export type { AiGatewayErrorCode, AiTaskResult } from './ai-provider-adapter';
export { AiGatewayError } from './ai-provider-adapter';
