/**
 * Pluggable AI research adapter.
 * Default: offline. User provides API key to enable industry/competitor/policy research.
 * Research results always include source annotation and retrieval date.
 * Network failures degrade gracefully — never block core analysis.
 */

export interface ResearchConfig {
  readonly provider: 'openai' | 'custom';
  readonly apiKey: string;
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
    if (parsed.apiKey && parsed.provider) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function saveResearchConfig(config: ResearchConfig): void {
  localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify({
    provider: config.provider,
    apiKey: config.apiKey,
    endpoint: config.endpoint,
    model: config.model,
  }));
}

export function clearResearchConfig(): void {
  localStorage.removeItem(STORAGE_KEY_CONFIG);
}

function buildSystemPrompt(): string {
  return `You are an investment research assistant. Provide concise, factual summaries with sources.

For each claim, cite a specific source (publication name, date if known, URL if available).
Format your response as a plain text summary followed by a "SOURCES:" section listing each source on a separate line.
Do not fabricate data. If information is uncertain, say so clearly.
Keep the summary under 500 words.`;
}

function buildQueryPrompt(query: ResearchQuery): string {
  const parts: string[] = [];
  parts.push(`Research topic: ${query.topic}`);
  parts.push(`Company: ${query.companyName}`);
  if (query.industry) parts.push(`Industry: ${query.industry}`);
  if (query.competitors?.length) parts.push(`Competitors: ${query.competitors.join(', ')}`);
  if (query.region) parts.push(`Region: ${query.region}`);
  parts.push('\nProvide a research summary with cited sources.');
  return parts.join('\n');
}

function parseResponse(text: string, query: ResearchQuery, provider: string, model: string): ResearchResult {
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

export async function executeResearch(
  config: ResearchConfig,
  query: ResearchQuery,
): Promise<ResearchResult> {
  const endpoint = config.endpoint ?? 'https://api.openai.com/v1/chat/completions';
  const model = config.model ?? 'gpt-4o-mini';

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildQueryPrompt(query) },
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

  return parseResponse(content, query, config.provider, model);
}

export function isOnline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine !== false;
}
