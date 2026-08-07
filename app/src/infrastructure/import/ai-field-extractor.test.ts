import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  registerAiGatewayRuntime,
  unregisterAiGatewayRuntime,
} from '../../features/ai-agents/ai-gateway-runtime';
import type { AiAgentSettings } from '../../features/ai-agents/types';
import { extractFieldsWithAI } from './ai-field-extractor';

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

describe('extractFieldsWithAI via AI Gateway', () => {
  beforeEach(() => {
    unregisterAiGatewayRuntime();
  });

  it('returns the vault locked message when no runtime is registered', async () => {
    const { fields, error } = await extractFieldsWithAI('某公司 2025 年营收 1 亿元');
    expect(fields).toBeNull();
    expect(error).toBe('本机 AI 密钥库已锁定，请先解锁');
  });

  it('runs all extraction passes through the document.extraction task and merges fields', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const userPrompt: string = body.messages[1].content;
      if (userPrompt.includes('提取公司信息和核心团队')) {
        return okResponse(JSON.stringify({ companyName: '测试公司', founded: '2020', industry: '半导体' }));
      }
      if (userPrompt.includes('提取所有财务数字')) {
        return okResponse(JSON.stringify({ revenue2025: '10000', grossMargin: '45' }));
      }
      return okResponse('{}');
    });
    registerAiGatewayRuntime({ settings, resolveSecret: () => 'sk-test', fetchImpl });

    const { fields, error } = await extractFieldsWithAI('测试公司成立于2020年，2025年营收1亿元，毛利率45%');
    expect(error).toBeUndefined();
    expect(fields?.companyName).toBe('测试公司');
    expect(fields?.revenue2025).toBe('10000');
    // 6 个提取 pass 全部经过 Gateway
    expect(fetchImpl.mock.calls.length).toBe(6);
    const firstInit = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((firstInit.headers as Headers).get('Authorization')).toBe('Bearer sk-test');
  });

  it('surfaces the normalized gateway message when every pass fails', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"bad key"}', { status: 401 }));
    registerAiGatewayRuntime({ settings, resolveSecret: () => 'sk-test', fetchImpl });

    const { fields, error } = await extractFieldsWithAI('一些文档内容');
    expect(fields).toBeNull();
    expect(error).toContain('API Key 无效');
  });
});
