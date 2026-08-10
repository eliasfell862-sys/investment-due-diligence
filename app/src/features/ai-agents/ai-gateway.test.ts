import { describe, expect, it, vi } from 'vitest';

import { executeAiTask, testAiConnection } from './ai-gateway';
import { AiGatewayError } from './ai-provider-adapter';
import type { AiFetch } from './ai-provider-adapter';
import type { AiAgentSettings, AiModelProfile } from './types';

const defaultProfile: AiModelProfile = {
  providerId: 'openai',
  model: 'gpt-4o-mini',
  endpoint: 'https://api.openai.com/v1/chat/completions',
  temperature: 0.2,
  maxOutputTokens: 2_000,
  secretId: 'secret-default',
};
const securitiesProfile: AiModelProfile = {
  providerId: 'deepseek',
  model: 'deepseek-chat',
  endpoint: 'https://api.deepseek.com/chat/completions',
  temperature: 0.1,
  maxOutputTokens: 3_000,
  secretId: 'secret-securities',
};
const settings: AiAgentSettings = {
  defaultProfile,
  featureOverrides: { securities: securitiesProfile },
  connectionStatuses: {},
  updatedAt: '2026-08-07T00:00:00.000Z',
};

function response(model: string): Response {
  return new Response(JSON.stringify({
    model,
    choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
  }), { status: 200 });
}

describe('AI Gateway', () => {
  it('uses the securities override and resolves only its secret', async () => {
    const resolveSecret = vi.fn((id: string) => id === 'secret-securities' ? 'sk-sec' : null);
    const fetchImpl = vi.fn(async () => response('deepseek-chat'));
    const result = await executeAiTask({
      taskId: 'securities.watchlist',
      systemPrompt: 'system',
      userPrompt: 'watchlist',
    }, { settings, resolveSecret, fetchImpl });

    expect(result.providerId).toBe('deepseek');
    expect(resolveSecret).toHaveBeenCalledWith('secret-securities');
  });

  it('inherits the default profile for due-diligence tasks', async () => {
    const fetchImpl = vi.fn(async () => response('gpt-4o-mini'));
    const result = await executeAiTask({
      taskId: 'due_diligence.research',
      systemPrompt: 'system',
      userPrompt: 'research',
    }, {
      settings,
      resolveSecret: (id) => id === 'secret-default' ? 'sk-default' : null,
      fetchImpl,
    });

    expect(result.providerId).toBe('openai');
  });

  it('reports a locked vault when settings are unavailable', async () => {
    await expect(executeAiTask({
      taskId: 'due_diligence.research', systemPrompt: 'system', userPrompt: 'research',
    }, { settings: null, resolveSecret: () => null, fetchImpl: vi.fn() })).rejects.toMatchObject({
      code: 'vault_locked',
    });
  });

  it('reports a missing required Key before calling fetch', async () => {
    const fetchImpl = vi.fn();
    await expect(executeAiTask({
      taskId: 'due_diligence.research', systemPrompt: 'system', userPrompt: 'research',
    }, { settings, resolveSecret: () => null, fetchImpl })).rejects.toMatchObject({
      code: 'missing_key',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses only the fixed connection-test prompt and caps output at 16 tokens', async () => {
    const fetchImpl = vi.fn<AiFetch>(async () => response('gpt-4o-mini'));
    await testAiConnection(defaultProfile, 'sk-default', fetchImpl);

    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are a connection test endpoint.' },
      { role: 'user', content: 'Return exactly: OK' },
    ]);
    expect(body.max_tokens).toBe(16);
    expect(JSON.stringify(body)).not.toContain('research');
  });

  it('uses normalized errors rather than raw configuration errors', async () => {
    try {
      await executeAiTask({
        taskId: 'due_diligence.research', systemPrompt: 'system', userPrompt: 'research',
      }, {
        settings: { ...settings, defaultProfile: { ...defaultProfile, endpoint: 'http://remote.test' } },
        resolveSecret: () => 'sk-default',
        fetchImpl: vi.fn(),
      });
    } catch (error) {
      expect(error).toBeInstanceOf(AiGatewayError);
      expect((error as AiGatewayError).code).toBe('provider_error');
      return;
    }
    throw new Error('Expected validation failure');
  });

  it('fills an empty endpoint from the provider preset before calling', async () => {
    const emptyEndpointProfile: AiModelProfile = {
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
      endpoint: '',
      temperature: 0.2,
      maxOutputTokens: 2_000,
      secretId: 'secret-empty',
    };
    const resolveSecret = vi.fn(() => 'sk-deepseek');
    const fetchImpl = vi.fn<AiFetch>(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe('https://api.deepseek.com/chat/completions');
      return response('deepseek-v4-flash');
    });
    const result = await executeAiTask({
      taskId: 'due_diligence.research', systemPrompt: 'system', userPrompt: 'research',
    }, {
      settings: { ...settings, defaultProfile: emptyEndpointProfile },
      resolveSecret,
      fetchImpl,
    });
    expect(result.providerId).toBe('deepseek');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('normalizes a legacy relative endpoint (/api/... proxy path) to the preset URL', async () => {
    const legacyProfile: AiModelProfile = {
      providerId: 'deepseek',
      model: 'deepseek-chat',
      endpoint: '/api/deepseek/v1/chat/completions',
      temperature: 0.2,
      maxOutputTokens: 2_000,
      secretId: 'secret-legacy',
    };
    const fetchImpl = vi.fn<AiFetch>(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe('https://api.deepseek.com/chat/completions');
      return response('deepseek-chat');
    });
    const result = await executeAiTask({
      taskId: 'due_diligence.research', systemPrompt: 'system', userPrompt: 'research',
    }, {
      settings: { ...settings, defaultProfile: legacyProfile },
      resolveSecret: () => 'sk-legacy',
      fetchImpl,
    });
    expect(result.providerId).toBe('deepseek');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
