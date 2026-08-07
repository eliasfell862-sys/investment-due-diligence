import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  registerAiGatewayRuntime,
  unregisterAiGatewayRuntime,
} from '../../features/ai-agents/ai-gateway-runtime';
import type { AiAgentSettings } from '../../features/ai-agents/types';
import { runAIReasoning } from './ai-reasoning';

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

describe('runAIReasoning via AI Gateway', () => {
  beforeEach(() => {
    localStorage.clear();
    unregisterAiGatewayRuntime();
  });

  it('returns the vault locked message when no runtime is registered', async () => {
    const { result, error } = await runAIReasoning('p1');
    expect(result).toBeNull();
    expect(error).toBe('本机 AI 密钥库已锁定，请先解锁');
  });

  it('sends the due_diligence.reasoning task with project context and parses the JSON result', async () => {
    localStorage.setItem('dd-p-p1-company-overview', JSON.stringify({ name: '测试公司' }));
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => okResponse(JSON.stringify({
      investmentThesis: '投资逻辑', keyHighlights: ['亮点一'],
      keyRisks: [{ risk: '风险一', mitigation: '应对一' }],
      competitivePosition: '竞争', valuationOpinion: '估值', growthOutlook: '增长',
      teamAssessment: '团队', businessModelQuality: '模式',
      recommendation: '有条件投资', keyConditions: ['条件一'],
      riskLevel: '中', convictionLevel: '高',
    })));
    registerAiGatewayRuntime({ settings, resolveSecret: () => 'sk-test', fetchImpl });

    const { result, error } = await runAIReasoning('p1');
    expect(error).toBeUndefined();
    expect(result?.investmentThesis).toBe('投资逻辑');
    expect(result?.keyRisks).toEqual([{ risk: '风险一', mitigation: '应对一' }]);
    expect(result?.recommendation).toBe('有条件投资');

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('deepseek-chat');
    expect(body.messages[1].content).toContain('测试公司');
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer sk-test');
  });

  it('maps gateway failures to the normalized Chinese message', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"bad key"}', { status: 401 }));
    registerAiGatewayRuntime({ settings, resolveSecret: () => 'sk-test', fetchImpl });

    const { result, error } = await runAIReasoning('p1');
    expect(result).toBeNull();
    expect(error).toBe('API Key 无效，请检查后重新保存');
  });
});
