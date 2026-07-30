/**
 * Company Research — AI-Powered Knowledge Extraction
 *
 * Uses the customer's already-configured AI model to research companies.
 * No additional API keys required — the AI model's training data covers
 * most known companies with reasonable accuracy.
 *
 * Optionally supplements with live web search via free CORS proxies.
 */

// ── Types ──

export interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly source: 'ai_knowledge' | 'web_search';
}

// ── Direct Baidu/Bing links for manual lookup (no API needed) ──

export function generateCompanySearchQueries(companyName: string): { label: string; query: string; engine: 'baidu' | 'bing' }[] {
  return [
    { label: '公司概览', query: `${companyName} 公司 简介 成立 总部 业务`, engine: 'baidu' },
    { label: '融资信息', query: `${companyName} 融资 估值 投资 轮次`, engine: 'baidu' },
    { label: '团队信息', query: `${companyName} 创始人 团队 管理层 背景`, engine: 'baidu' },
    { label: '财务数据', query: `${companyName} 财报 收入 利润 增长 营收`, engine: 'baidu' },
    { label: '行业分析', query: `${companyName} 行业 市场 TAM 竞争 趋势`, engine: 'baidu' },
    { label: '最新动态', query: `${companyName} 新闻 2024 2025 最新`, engine: 'bing' },
  ];
}

export function baiduSearchUrl(query: string): string {
  return `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`;
}

export function bingSearchUrl(query: string): string {
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-Hans`;
}
