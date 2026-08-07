/**
 * Pluggable AI research adapter.
 *
 * 传输层已迁移到统一 AI Gateway（app/src/features/ai-agents/ai-gateway.ts），
 * ResearchPage 通过 executeAiTask + 本机加密密钥库调用，不再接触明文 Key。
 *
 * @deprecated loadResearchConfig / saveResearchConfig / clearResearchConfig /
 * PROVIDER_PRESETS / executeResearch 仅为其余 AI 调用方保留的兼容导出，
 * 将在第二批迁移计划中移除。新代码请使用 AI Gateway。
 */

export type ResearchProvider = 'ollama' | 'openai' | 'deepseek' | 'kimi' | 'custom';

const isDev = typeof window !== 'undefined' && window.location.hostname === 'localhost';

export const PROVIDER_PRESETS: Record<ResearchProvider, { endpoint: string; defaultModel: string; needsKey: boolean }> = {
  ollama: { endpoint: 'http://localhost:11434/v1/chat/completions', defaultModel: 'deepseek-r1:14b', needsKey: false },
  openai: { endpoint: isDev ? '/api/openai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions', defaultModel: 'gpt-4o-mini', needsKey: true },
  deepseek: { endpoint: isDev ? '/api/deepseek/v1/chat/completions' : 'https://api.deepseek.com/v1/chat/completions', defaultModel: 'deepseek-chat', needsKey: true },
  kimi: { endpoint: isDev ? '/api/kimi/v1/chat/completions' : 'https://api.moonshot.cn/v1/chat/completions', defaultModel: 'moonshot-v1-8k', needsKey: true },
  custom: { endpoint: '', defaultModel: '', needsKey: true },
};

export interface ResearchConfig {
  readonly provider: ResearchProvider;
  readonly apiKey?: string;
  readonly endpoint?: string;
  readonly model?: string;
}

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

const STORAGE_KEY_CONFIG = 'dd-research-config';

export function loadResearchConfig(): ResearchConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CONFIG);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.provider) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function saveResearchConfig(config: ResearchConfig): void {
  localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify({
    provider: config.provider,
    apiKey: config.apiKey ?? '',
    endpoint: config.endpoint,
    model: config.model,
  }));
}

export function clearResearchConfig(): void {
  localStorage.removeItem(STORAGE_KEY_CONFIG);
}

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

/**
 * @deprecated 旧传输层，仅保留给未迁移的调用方。新代码使用 executeAiTask。
 */
export async function executeResearch(
  config: ResearchConfig,
  query: ResearchQuery,
): Promise<ResearchResult> {
  const endpoint = config.endpoint ?? 'https://api.openai.com/v1/chat/completions';
  const model = config.model ?? 'gpt-4o-mini';

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: buildResearchSystemPrompt() },
        { role: 'user', content: buildResearchQueryPrompt(query) },
      ],
      max_tokens: 2000,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Research API error (${response.status}): ${errorText.slice(0, 200)}`);
  }

  const data = await response.json() as Record<string, unknown>;
  const choices = data.choices as Array<{ message: { content: string } }> | undefined;
  const content = choices?.[0]?.message?.content;

  if (!content || typeof content !== 'string') {
    throw new Error('Research API returned empty or invalid response.');
  }

  return parseResearchResponse(content, query, config.provider, model);
}

export function isOnline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine !== false;
}
