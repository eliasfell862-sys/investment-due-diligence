import { describe, expect, it } from 'vitest';

import { AI_PROVIDER_PRESETS, validateAiEndpoint } from './provider-presets';
import type { AiModelProfile } from './types';

function profile(overrides: Partial<AiModelProfile> = {}): AiModelProfile {
  return {
    providerId: 'custom',
    model: 'model-a',
    endpoint: 'https://example.com/v1/chat/completions',
    temperature: 0.3,
    maxOutputTokens: 2_000,
    ...overrides,
  };
}

describe('AI provider presets', () => {
  it('keeps the supported providers in the product-defined order', () => {
    expect(Object.keys(AI_PROVIDER_PRESETS)).toEqual([
      'deepseek',
      'kimi',
      'qwen',
      'glm',
      'doubao',
      'openai',
      'ollama',
      'custom',
    ]);
  });

  it('requires a Key for every preset except Ollama', () => {
    expect(
      Object.values(AI_PROVIDER_PRESETS)
        .filter((preset) => !preset.needsKey)
        .map((preset) => preset.id),
    ).toEqual(['ollama']);
  });

  it('ships the agreed default model for each provider', () => {
    expect(
      Object.fromEntries(
        Object.values(AI_PROVIDER_PRESETS).map((preset) => [preset.id, preset.defaultModel]),
      ),
    ).toEqual({
      deepseek: 'deepseek-v4-pro',
      kimi: 'moonshot-v1-8k',
      qwen: 'qwen-plus',
      glm: 'glm-4-flash',
      doubao: 'doubao-pro-32k',
      openai: 'gpt-4o-mini',
      ollama: 'qwen2.5:14b',
      custom: '',
    });
  });
});

describe('validateAiEndpoint', () => {
  it('rejects invalid URLs', () => {
    expect(() => validateAiEndpoint(profile({ endpoint: 'not-a-url' }))).toThrow(
      'AI Endpoint 格式无效',
    );
  });

  it('rejects remote HTTP endpoints', () => {
    expect(() =>
      validateAiEndpoint(profile({ endpoint: 'http://example.com/v1/chat/completions' })),
    ).toThrow('远程 AI Endpoint 必须使用 HTTPS');
  });

  it.each([
    'http://localhost:11434/v1/chat/completions',
    'http://127.0.0.1:11434/v1/chat/completions',
    'http://[::1]:11434/v1/chat/completions',
  ])('allows local Ollama over HTTP: %s', (endpoint) => {
    expect(
      validateAiEndpoint(
        profile({ providerId: 'ollama', model: 'qwen2.5:14b', endpoint }),
      ),
    ).toBeUndefined();
  });

  it('does not allow other providers to use local HTTP', () => {
    expect(() =>
      validateAiEndpoint(profile({ endpoint: 'http://localhost:8080/v1/chat/completions' })),
    ).toThrow('远程 AI Endpoint 必须使用 HTTPS');
  });

  it('rejects unsupported protocols', () => {
    expect(() => validateAiEndpoint(profile({ endpoint: 'ftp://example.com/model' }))).toThrow(
      '远程 AI Endpoint 必须使用 HTTPS',
    );
  });
});
