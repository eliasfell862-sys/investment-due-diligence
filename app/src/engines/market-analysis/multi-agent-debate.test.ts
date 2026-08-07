import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  registerAiGatewayRuntime,
  unregisterAiGatewayRuntime,
} from '../../features/ai-agents/ai-gateway-runtime';
import type { AiAgentSettings } from '../../features/ai-agents/types';
import { runMultiAgentDebate } from './multi-agent-debate';

const settings: AiAgentSettings = {
  defaultProfile: {
    providerId: 'deepseek', model: 'deepseek-chat',
    endpoint: 'https://api.deepseek.com/chat/completions',
    temperature: 0.2, maxOutputTokens: 2_000, secretId: 'default:deepseek',
  },
  featureOverrides: {
    securities: {
      providerId: 'kimi', model: 'moonshot-v1-8k',
      endpoint: 'https://api.moonshot.cn/v1/chat/completions',
      temperature: 0.2, maxOutputTokens: 2_000, secretId: 'securities:kimi',
    },
  },
  connectionStatuses: {}, updatedAt: '2026-08-07T00:00:00.000Z',
};

function okResponse(content: string): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('runMultiAgentDebate via AI Gateway', () => {
  beforeEach(() => {
    unregisterAiGatewayRuntime();
  });

  it('degrades gracefully when the vault is locked', async () => {
    const result = await runMultiAgentDebate('600519', '贵州茅台', 1439.41, 1.2, 'quick');
    expect(result.reports[0]?.thesis).toContain('AI 分析服务暂不可用');
  });

  it('runs the five agents through the securities.multi_agent task with the feature override', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      okResponse('核心观点：值得买入\n论据一：品牌护城河\n论据二：渠道优势'));
    registerAiGatewayRuntime({ settings, resolveSecret: () => 'sk-test', fetchImpl });

    const result = await runMultiAgentDebate('600519', '贵州茅台', 1439.41, 1.2, 'quick');
    expect(fetchImpl.mock.calls.length).toBe(5);
    // securities 功能组应命中 kimi 覆盖配置
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toBe('https://api.moonshot.cn/v1/chat/completions');
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body)).model).toBe('moonshot-v1-8k');
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer sk-test');

    expect(result.reports.length).toBe(5);
    expect(result.reports[0]?.thesis).toContain('核心观点');
    expect(result.consensus).toContain('贵州茅台');
  });

  it('adds rebuttal and synthesis rounds at deep depth', async () => {
    const fetchImpl = vi.fn(async () => okResponse('反驳观点\n理由一\n理由二'));
    registerAiGatewayRuntime({ settings, resolveSecret: () => 'sk-test', fetchImpl });

    const result = await runMultiAgentDebate('600519', '贵州茅台', 1439.41, 1.2, 'deep');
    // 5 首轮 + 2 反驳 + 1 综合
    expect(fetchImpl.mock.calls.length).toBe(8);
    expect(result.rounds.map((r) => r.round)).toEqual([1, 2, 3]);
  });
});
