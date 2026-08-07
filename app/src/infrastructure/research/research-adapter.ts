/**
 * Pluggable AI research adapter.
 *
 * 传输层已迁移到统一 AI Gateway（app/src/features/ai-agents/ai-gateway.ts），
 * 所有 AI 调用通过 executeAiTask + 本机加密密钥库完成，不再接触明文 Key。
 * 本文件仅保留与传输无关的提示词构建/响应解析工具。
 */

export interface ResearchQuery {
  readonly topic: 'industry' | 'competitors' | 'policy' | 'market_size';
  readonly companyName: string;
  readonly industry?: string;
  readonly competitors?: string[];
  readonly region?: string;
  readonly maxResults?: number;
}

export interface ResearchResult {
  readonly query: ResearchQuery;
  readonly summary: string;
  readonly sources: readonly ResearchSource[];
  readonly retrievedAt: string;
  readonly provider: string;
  readonly model: string;
}

export interface ResearchSource {
  readonly title: string;
  readonly url?: string;
  readonly snippet: string;
  readonly date?: string;
}

export type ResearchState =
  | { readonly status: 'unconfigured' }
  | { readonly status: 'configured'; readonly provider: string }
  | { readonly status: 'researching' }
  | { readonly status: 'ready'; readonly result: ResearchResult }
  | { readonly status: 'error'; readonly message: string };

export function buildResearchSystemPrompt(): string {
  return `你是一位投资研究助手。提供简洁、有据可查的中文摘要。

每个观点需注明具体来源（出版物名称、日期、URL）。
回复格式：先写一段中文摘要（500字以内），然后写"SOURCES:"，每行一个来源。
不确定的信息要明确说明。不要编造数据。`;
}

export function buildResearchQueryPrompt(query: ResearchQuery): string {
  const parts: string[] = [];
  parts.push(`Research topic: ${query.topic}`);
  parts.push(`Company: ${query.companyName}`);
  if (query.industry) parts.push(`Industry: ${query.industry}`);
  if (query.competitors?.length) parts.push(`Competitors: ${query.competitors.join(', ')}`);
  if (query.region) parts.push(`Region: ${query.region}`);
  parts.push('\nProvide a research summary with cited sources.');
  return parts.join('\n');
}

export function parseResearchResponse(text: string, query: ResearchQuery, provider: string, model: string): ResearchResult {
  const sections = text.split(/SOURCES:/i);
  const summary = (sections[0] ?? text).trim();
  const sourcesText = sections.length > 1 ? sections[1]!.trim() : '';

  const sources: ResearchSource[] = sourcesText
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const cleaned = line.replace(/^[-*\d.]\s*/, '').trim();
      const urlMatch = cleaned.match(/(https?:\/\/\S+)/);
      return {
        title: urlMatch ? cleaned.replace(urlMatch[0], '').trim() : cleaned,
        url: urlMatch?.[0],
        snippet: cleaned.slice(0, 200),
        date: undefined,
      };
    });

  return {
    query,
    summary,
    sources,
    retrievedAt: new Date().toISOString(),
    provider,
    model,
  };
}

export function isOnline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine !== false;
}
