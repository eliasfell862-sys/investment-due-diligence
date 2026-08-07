import { describe, expect, it, vi } from 'vitest';

import {
  AiGatewayError,
  executeOpenAiCompatibleRequest,
  type AiFetch,
} from './ai-provider-adapter';
import type { AiModelProfile } from './types';

const cloudProfile: AiModelProfile = {
  providerId: 'deepseek',
  model: 'deepseek-chat',
  endpoint: 'https://api.deepseek.com/chat/completions',
  temperature: 0.25,
  maxOutputTokens: 1_234,
};

function successResponse(content = 'OK'): Response {
  return new Response(JSON.stringify({
    model: 'deepseek-chat',
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 11, completion_tokens: 3 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function captureGatewayError(action: () => Promise<unknown>): Promise<AiGatewayError> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(AiGatewayError);
    return error as AiGatewayError;
  }
  throw new Error('Expected request to fail');
}

describe('OpenAI-compatible provider adapter', () => {
  it('sends cloud authorization and configured generation limits', async () => {
    const fetchImpl = vi.fn<AiFetch>(async () => successResponse('analysis complete'));

    const result = await executeOpenAiCompatibleRequest({
      profile: cloudProfile,
      key: 'sk-test-value',
      systemPrompt: 'system',
      userPrompt: 'user',
      responseFormat: 'json',
      fetchImpl,
    });

    const [, init] = fetchImpl.mock.calls[0];
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body));
    expect(headers.get('Authorization')).toBe('Bearer sk-test-value');
    expect(body).toMatchObject({
      model: 'deepseek-chat',
      temperature: 0.25,
      max_tokens: 1_234,
      response_format: { type: 'json_object' },
    });
    expect(result).toMatchObject({
      content: 'analysis complete',
      providerId: 'deepseek',
      model: 'deepseek-chat',
      inputTokens: 11,
      outputTokens: 3,
      finishReason: 'stop',
    });
    expect(JSON.stringify(result)).not.toContain('sk-test-value');
  });

  it('sends no Authorization header to Ollama', async () => {
    const fetchImpl = vi.fn<AiFetch>(async () => successResponse());
    await executeOpenAiCompatibleRequest({
      profile: { ...cloudProfile, providerId: 'ollama' },
      key: null,
      systemPrompt: 'system',
      userPrompt: 'user',
      fetchImpl,
    });

    const headers = new Headers(fetchImpl.mock.calls[0][1]?.headers);
    expect(headers.has('Authorization')).toBe(false);
  });

  it.each([
    [401, 'invalid_key'],
    [403, 'permission_denied'],
    [404, 'model_not_found'],
    [429, 'rate_limited'],
  ] as const)('maps HTTP %s to %s', async (status, code) => {
    const error = await captureGatewayError(() => executeOpenAiCompatibleRequest({
      profile: cloudProfile,
      key: 'sk-test-value',
      systemPrompt: 'system',
      userPrompt: 'user',
      fetchImpl: vi.fn(async () => new Response('{"error":"request failed"}', { status })),
    }));

    expect(error.code).toBe(code);
    expect(error.userMessage.length).toBeGreaterThan(0);
    expect(JSON.stringify(error)).not.toContain('sk-test-value');
  });

  it('recognizes insufficient balance without exposing the raw body', async () => {
    const error = await captureGatewayError(() => executeOpenAiCompatibleRequest({
      profile: cloudProfile,
      key: 'sk-test-value',
      systemPrompt: 'system',
      userPrompt: 'user',
      fetchImpl: vi.fn(async () => new Response('余额不足 account=private', { status: 400 })),
    }));

    expect(error.code).toBe('insufficient_balance');
    expect(error.userMessage).not.toContain('account=private');
  });

  it('maps AbortError to timeout', async () => {
    const error = await captureGatewayError(() => executeOpenAiCompatibleRequest({
      profile: cloudProfile,
      key: 'sk-test-value',
      systemPrompt: 'system',
      userPrompt: 'user',
      fetchImpl: vi.fn(async () => { throw new DOMException('aborted', 'AbortError'); }),
    }));
    expect(error.code).toBe('timeout');
  });

  it('maps an online Failed to fetch error to cors_blocked', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    const error = await captureGatewayError(() => executeOpenAiCompatibleRequest({
      profile: cloudProfile,
      key: 'sk-test-value',
      systemPrompt: 'system',
      userPrompt: 'user',
      fetchImpl: vi.fn(async () => { throw new TypeError('Failed to fetch'); }),
    }));
    expect(error.code).toBe('cors_blocked');
  });

  it('rejects structurally invalid successful responses', async () => {
    const error = await captureGatewayError(() => executeOpenAiCompatibleRequest({
      profile: cloudProfile,
      key: 'sk-test-value',
      systemPrompt: 'system',
      userPrompt: 'user',
      fetchImpl: vi.fn(async () => new Response('{"choices":[]}', { status: 200 })),
    }));
    expect(error.code).toBe('invalid_response');
  });
});
