/**
 * Web Search Adapter for Company Research
 *
 * Supports multiple search backends:
 * - Bing Web Search API (Microsoft, $3/1000 calls after free tier)
 * - Tavily (free tier: 1000/month, structured content)
 * - SerpAPI (Google search results)
 *
 * Results are fed into the AI extraction pipeline to auto-fill analysis modules.
 */

// ── Types ──

export type SearchProvider = 'bing' | 'tavily' | 'serpapi';

export interface SearchConfig {
  readonly provider: SearchProvider;
  readonly apiKey: string;
  readonly endpoint?: string;
}

export interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly content?: string; // full text if available
  readonly date?: string;
}

export interface SearchResponse {
  readonly query: string;
  readonly results: readonly SearchResult[];
  readonly totalResults: number;
  readonly searchTime: number;
}

// ── Constants ──

const STORAGE_KEY = 'dd-search-config';

export const SEARCH_PROVIDER_PRESETS: Record<SearchProvider, { endpoint: string; label: string; needsKey: boolean }> = {
  bing: { endpoint: 'https://api.bing.microsoft.com/v7.0/search', label: 'Bing 搜索 (微软官方，推荐)', needsKey: true },
  tavily: { endpoint: 'https://api.tavily.com/search', label: 'Tavily (免费1000次/月)', needsKey: true },
  serpapi: { endpoint: 'https://serpapi.com/search', label: 'SerpAPI (Google搜索)', needsKey: true },
};

export function loadSearchConfig(): SearchConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveSearchConfig(config: SearchConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

// ── Search Execution ──

export async function searchCompany(
  companyName: string,
  config: SearchConfig,
  searchDepth: 'basic' | 'advanced' = 'advanced',
): Promise<SearchResponse> {
  const endpoint = config.endpoint || SEARCH_PROVIDER_PRESETS[config.provider].endpoint;

  if (config.provider === 'bing') {
    return searchBing(companyName, config.apiKey, endpoint);
  }
  if (config.provider === 'tavily') {
    return searchTavily(companyName, config.apiKey, endpoint, searchDepth);
  }
  if (config.provider === 'serpapi') {
    return searchSerpApi(companyName, config.apiKey, endpoint);
  }
  return searchTavily(companyName, config.apiKey, endpoint, searchDepth);
}

async function searchBing(
  companyName: string, apiKey: string, endpoint: string,
): Promise<SearchResponse> {
  const startTime = Date.now();
  const queries = [
    `${companyName} 公司 融资 估值 团队`,
    `${companyName} 财报 收入 利润`,
    `${companyName} 行业 市场 竞品`,
    `${companyName} 创始人 产品`,
  ];

  const allResults: SearchResult[] = [];

  for (const query of queries) {
    try {
      const url = `${endpoint}?q=${encodeURIComponent(query)}&count=5&mkt=zh-CN&setLang=zh-Hans`;
      const resp = await fetch(url, {
        headers: { 'Ocp-Apim-Subscription-Key': apiKey },
      });
      if (!resp.ok) continue;
      const data = await resp.json() as Record<string, unknown>;
      const webPages = (data as any).webPages;
      const pages = (webPages?.value || []) as Array<Record<string, unknown>>;
      for (const p of pages) {
        allResults.push({
          title: String(p.name || ''),
          url: String(p.url || ''),
          snippet: String(p.snippet || ''),
          date: p.dateLastCrawled ? String(p.dateLastCrawled) : undefined,
        });
      }
    } catch { /* continue */ }
  }

  // Deduplicate
  const seen = new Set<string>();
  const unique = allResults.filter(r => {
    if (seen.has(r.url) || !r.snippet) return false;
    seen.add(r.url);
    return true;
  });

  return {
    query: companyName,
    results: unique.slice(0, 20),
    totalResults: unique.length,
    searchTime: Date.now() - startTime,
  };
}

async function searchTavily(
  companyName: string, apiKey: string, endpoint: string, depth: 'basic' | 'advanced',
): Promise<SearchResponse> {
  const queries = [
    `${companyName} 公司 融资 估值 投资`,
    `${companyName} 团队 创始人 管理层`,
    `${companyName} 财报 收入 盈利 增长`,
    `${companyName} 行业 市场 竞争对手`,
  ];

  const allResults: SearchResult[] = [];
  const startTime = Date.now();

  // Run 4 searches in parallel for comprehensive coverage
  const searchPromises = queries.map(async (query) => {
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          query,
          search_depth: depth,
          max_results: depth === 'advanced' ? 5 : 3,
          include_answer: true,
          include_raw_content: false,
        }),
      });
      if (!resp.ok) return [];
      const data = await resp.json() as Record<string, unknown>;
      const results = data.results as Array<Record<string, unknown>> | undefined;
      return (results || []).map((r: Record<string, unknown>) => ({
        title: String(r.title || ''),
        url: String(r.url || ''),
        snippet: String(r.content || r.snippet || ''),
        content: String(r.raw_content || r.content || ''),
        date: r.published_date ? String(r.published_date) : undefined,
      }));
    } catch {
      return [];
    }
  });

  const resultBatches = await Promise.all(searchPromises);
  for (const batch of resultBatches) {
    allResults.push(...batch);
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  const unique: SearchResult[] = [];
  for (const r of allResults) {
    if (!seen.has(r.url) && r.snippet) {
      seen.add(r.url);
      unique.push(r);
    }
  }

  return {
    query: companyName,
    results: unique.slice(0, 20),
    totalResults: unique.length,
    searchTime: Date.now() - startTime,
  };
}

async function searchSerpApi(
  companyName: string, apiKey: string, endpoint: string,
): Promise<SearchResponse> {
  const startTime = Date.now();
  const queries = [
    `${companyName} company funding valuation investment`,
    `${companyName} founder team leadership`,
  ];

  const allResults: SearchResult[] = [];

  for (const query of queries) {
    try {
      const url = `${endpoint}?q=${encodeURIComponent(query)}&api_key=${apiKey}&num=5&hl=zh-CN&gl=cn`;
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const data = await resp.json() as Record<string, unknown>;
      const organic = data.organic_results as Array<Record<string, unknown>> | undefined;
      if (organic) {
        for (const r of organic) {
          allResults.push({
            title: String(r.title || ''),
            url: String(r.link || ''),
            snippet: String(r.snippet || ''),
          });
        }
      }
    } catch { /* continue */ }
  }

  // Deduplicate
  const seen = new Set<string>();
  const unique = allResults.filter(r => {
    if (seen.has(r.url) || !r.snippet) return false;
    seen.add(r.url);
    return true;
  });

  return {
    query: companyName,
    results: unique.slice(0, 15),
    totalResults: unique.length,
    searchTime: Date.now() - startTime,
  };
}

// ── Direct Baidu search (no API key needed, opens browser) ──

export function generateCompanySearchQueries(companyName: string): { label: string; query: string }[] {
  return [
    { label: '公司概览', query: `${companyName} 公司 简介 成立 总部` },
    { label: '融资信息', query: `${companyName} 融资 估值 投资轮次` },
    { label: '团队信息', query: `${companyName} 创始人 团队 管理层` },
    { label: '财务数据', query: `${companyName} 财报 收入 利润 增长` },
    { label: '行业分析', query: `${companyName} 行业 市场 趋势 竞争` },
    { label: '最新动态', query: `${companyName} 最新 新闻 2024 2025` },
  ];
}

export function searchUrl(query: string): string {
  return `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`;
}
