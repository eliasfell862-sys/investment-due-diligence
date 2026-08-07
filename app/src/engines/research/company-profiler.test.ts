import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  registerAiGatewayRuntime,
  unregisterAiGatewayRuntime,
} from '../../features/ai-agents/ai-gateway-runtime';
import type { AiAgentSettings } from '../../features/ai-agents/types';
import { profileCompany } from './company-profiler';

const settings: AiAgentSettings = {
  defaultProfile: {
    providerId: 'deepseek', model: 'deepseek-chat',
    endpoint: 'https://api.deepseek.com/chat/completions',
    temperature: 0.2, maxOutputTokens: 2_000, secretId: 'default:deepseek',
  },
  featureOverrides: {}, connectionStatuses: {}, updatedAt: '2026-08-07T00:00:00.000Z',
};

function okResponse(content: string): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('profileCompany via AI Gateway', () => {
  beforeEach(() => {
    unregisterAiGatewayRuntime();
  });

  it('returns the vault locked message when no runtime is registered', async () => {
    const { profile, error } = await profileCompany('测试公司');
    expect(profile).toBeNull();
    expect(error).toBe('本机 AI 密钥库已锁定，请先解锁');
  });

  it('runs all profiling queries through the due_diligence.research task', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const userPrompt: string = body.messages[1].content;
      if (userPrompt.includes('companyName')) {
        return okResponse(JSON.stringify({
          companyName: '测试公司', founded: '2020', headquarters: '上海',
          businessModel: 'SaaS', website: 'https://example.com',
        }));
      }
      return okResponse('{}');
    });
    registerAiGatewayRuntime({ settings, resolveSecret: () => 'sk-test', fetchImpl });

    const { profile, error } = await profileCompany('测试公司');
    expect(error).toBeUndefined();
    expect(profile?.companyName).toBe('测试公司');
    expect(profile?.founded).toBe('2020');
    expect(fetchImpl.mock.calls.length).toBe(20);
    const firstInit = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((firstInit.headers as Headers).get('Authorization')).toBe('Bearer sk-test');
  });

  it('returns the empty-extraction message when every query fails', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"bad key"}', { status: 401 }));
    registerAiGatewayRuntime({ settings, resolveSecret: () => 'sk-test', fetchImpl });

    const { profile, error } = await profileCompany('测试公司');
    expect(profile).toBeNull();
    expect(error).toContain('AI 未返回有效信息');
  });
});
