import { describe, expect, it } from 'vitest';

import {
  buildResearchQueryPrompt,
  buildResearchSystemPrompt,
  parseResearchResponse,
  type ResearchQuery,
} from './research-adapter';

const query: ResearchQuery = {
  topic: 'industry',
  companyName: '测试公司',
  industry: '半导体',
  region: 'China',
};

describe('research-adapter prompt builders', () => {
  it('builds the system prompt with source citation rules', () => {
    const prompt = buildResearchSystemPrompt();
    expect(prompt).toContain('投资研究助手');
    expect(prompt).toContain('SOURCES:');
  });

  it('builds the query prompt from all provided fields', () => {
    const prompt = buildResearchQueryPrompt(query);
    expect(prompt).toContain('Research topic: industry');
    expect(prompt).toContain('Company: 测试公司');
    expect(prompt).toContain('Industry: 半导体');
    expect(prompt).toContain('Region: China');
  });

  it('omits optional fields that are absent', () => {
    const prompt = buildResearchQueryPrompt({ topic: 'policy', companyName: '测试公司' });
    expect(prompt).not.toContain('Industry:');
    expect(prompt).not.toContain('Competitors:');
    expect(prompt).not.toContain('Region:');
  });
});

describe('parseResearchResponse', () => {
  it('splits summary and sources on the SOURCES marker', () => {
    const result = parseResearchResponse(
      '摘要第一段。\n\nSOURCES:\n- 行业报告 https://example.com/a\n- 新闻标题',
      query, 'deepseek', 'deepseek-chat',
    );
    expect(result.summary).toBe('摘要第一段。');
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]).toMatchObject({ title: '行业报告', url: 'https://example.com/a' });
    expect(result.sources[1]).toMatchObject({ title: '新闻标题' });
    expect(result.sources[1]?.url).toBeUndefined();
    expect(result.provider).toBe('deepseek');
    expect(result.model).toBe('deepseek-chat');
    expect(result.query).toBe(query);
  });

  it('treats the whole body as summary when no SOURCES marker exists', () => {
    const result = parseResearchResponse('没有来源标记的正文', query, 'kimi', 'moonshot-v1-8k');
    expect(result.summary).toBe('没有来源标记的正文');
    expect(result.sources).toHaveLength(0);
  });
});
