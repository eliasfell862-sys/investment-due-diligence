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
  validateProfile(profile);
  const key = resolveProfileKey(profile, runtime.resolveSecret);

  return executeOpenAiCompatibleRequest({
    profile,
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
  validateProfile(profile);
  const preset = AI_PROVIDER_PRESETS[profile.providerId];
  if (preset.needsKey && !key) throw createAiGatewayError('missing_key');

  return executeOpenAiCompatibleRequest({
    profile: { ...profile, maxOutputTokens: Math.min(profile.maxOutputTokens, 16) },
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
