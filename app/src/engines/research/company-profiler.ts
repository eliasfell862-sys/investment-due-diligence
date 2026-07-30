/**
 * Company Profiler — AI-powered company research from search results
 *
 * Takes search result snippets and uses AI to extract structured fields
 * that can be auto-filled into analysis modules.
 */

import { loadResearchConfig, PROVIDER_PRESETS } from '../../infrastructure/research/research-adapter';
import type { SearchResult } from '../../infrastructure/search/search-adapter';

// ── Types ──

export interface CompanyProfile {
  // Company Overview
  companyName: string;
  businessDescription: string;
  founded: string;
  headquarters: string;
  businessModel: string;
  website: string;
  employeeCount: string;

  // Financial
  revenue: string;
  revenueGrowth: string;
  grossMargin: string;
  netIncome: string;
  ebitda: string;
  valuation: string;
  totalFunding: string;

  // Team
  founders: { name: string; role: string; background: string }[];

  // Market
  industry: string;
  tam: string;
  marketGrowth: string;
  competitors: { name: string; description: string }[];

  // Investment
  latestRound: string;
  latestRoundAmount: string;
  latestRoundDate: string;
  keyInvestors: string[];

  // Products
  mainProducts: { name: string; description: string }[];

  // Source citations
  sources: { title: string; url: string; usedFor: string }[];
}

export interface ProfileResult {
  readonly profile: CompanyProfile | null;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly filledFields: string[];
  readonly error?: string;
}

// ── AI Profiling ──

async function callAI(prompt: string): Promise<string> {
  const cfg = loadResearchConfig();
  if (!cfg) throw new Error('AI未配置');

  const preset = PROVIDER_PRESETS[cfg.provider] ?? PROVIDER_PRESETS.custom;
  const endpoint = cfg.endpoint || preset.endpoint || 'http://localhost:11434/v1/chat/completions';
  const model = cfg.model || (cfg.provider === 'ollama' ? 'deepseek-r1:14b' : 'deepseek-chat');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

  const resp = await fetch(endpoint, {
    method: 'POST', headers,
    body: JSON.stringify({
      model, messages: [
        { role: 'system', content: '你必须且只能返回一个JSON对象。不输出markdown、不解释。没有信息就填null。' },
        { role: 'user', content: prompt },
      ], max_tokens: 4096, temperature: 0,
    }),
  });
  if (!resp.ok) throw new Error(`API ${resp.status}`);
  const data = await resp.json() as Record<string, unknown>;
  const content = (data.choices as Array<{ message: { content: unknown } }>)?.[0]?.message?.content;
  return typeof content === 'string' ? content : JSON.stringify(content || {});
}

function parseAIJson(raw: string): Record<string, unknown> {
  // Clean and parse AI response
  let t = raw;
  t = t.replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '');
  t = t.replace(/```json\s*/gi, '').replace(/```\s*/gi, '');
  t = t.replace(/"/g, '"').replace(/"/g, '"');
  t = t.replace(/，/g, ',').replace(/：/g, ':');

  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);

  // String-aware bracket extraction
  let depth = 0, inStr = false, esc = false, realEnd = -1;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { realEnd = i; break; } }
  }
  if (realEnd > 0) t = t.slice(0, realEnd + 1);

  try { return JSON.parse(t); } catch {
    // Try unquoted keys
    try { return JSON.parse(t.replace(/(\{|\,)\s*(\w+)\s*\:/g, '$1"$2":')); } catch { return {}; }
  }
}

export async function profileCompanyFromSearch(
  companyName: string,
  searchResults: readonly SearchResult[],
): Promise<ProfileResult> {
  const searchText = searchResults
    .map((r, i) => `[${i + 1}] 标题: ${r.title}\nURL: ${r.url}\n摘要: ${r.snippet}${r.content ? '\n内容: ' + r.content.slice(0, 1000) : ''}`)
    .join('\n\n---\n\n');

  if (!searchText.trim()) {
    return { profile: null, confidence: 'low', filledFields: [], error: '无搜索结果' };
  }

  try {
    const prompt = `基于以下关于"${companyName}"的网络搜索结果，提取公司信息。只返回JSON，没有的字段填null。

{
  "companyName": "${companyName}",
  "businessDescription": "公司业务描述(100字以内)",
  "founded": "成立年份",
  "headquarters": "总部城市",
  "businessModel": "商业模式(SaaS/ecommerce/hardware/service等)",
  "website": "官网URL",
  "employeeCount": "员工数量",
  "revenue": "营收(万元人民币)",
  "revenueGrowth": "营收增速(百分比数字)",
  "grossMargin": "毛利率(百分比数字)",
  "netIncome": "净利润(万元)",
  "ebitda": "EBITDA(万元)",
  "valuation": "最新估值(万元)",
  "totalFunding": "累计融资额(万元)",
  "founders": [{"name":"姓名","role":"职位","background":"背景"}],
  "industry": "所属行业",
  "tam": "市场规模TAM(万元)",
  "marketGrowth": "市场增速(百分比)",
  "competitors": [{"name":"竞品名","description":"简介"}],
  "latestRound": "最新融资轮次(天使/A/B/C等)",
  "latestRoundAmount": "最新轮次金额(万元)",
  "latestRoundDate": "最新轮次日期",
  "keyInvestors": ["投资方1","投资方2"],
  "mainProducts": [{"name":"产品名","description":"描述"}]
}

搜索结果：
${searchText.slice(0, 8000)}`;

    const result = await callAI(prompt);
    const parsed = parseAIJson(result);

    // Build profile with defaults
    const profile: CompanyProfile = {
      companyName: String(parsed.companyName || companyName),
      businessDescription: String(parsed.businessDescription || ''),
      founded: String(parsed.founded || ''),
      headquarters: String(parsed.headquarters || ''),
      businessModel: String(parsed.businessModel || ''),
      website: String(parsed.website || ''),
      employeeCount: String(parsed.employeeCount || ''),
      revenue: String(parsed.revenue || ''),
      revenueGrowth: String(parsed.revenueGrowth || ''),
      grossMargin: String(parsed.grossMargin || ''),
      netIncome: String(parsed.netIncome || ''),
      ebitda: String(parsed.ebitda || ''),
      valuation: String(parsed.valuation || ''),
      totalFunding: String(parsed.totalFunding || ''),
      founders: Array.isArray(parsed.founders) ? parsed.founders : [],
      industry: String(parsed.industry || ''),
      tam: String(parsed.tam || ''),
      marketGrowth: String(parsed.marketGrowth || ''),
      competitors: Array.isArray(parsed.competitors) ? parsed.competitors : [],
      latestRound: String(parsed.latestRound || ''),
      latestRoundAmount: String(parsed.latestRoundAmount || ''),
      latestRoundDate: String(parsed.latestRoundDate || ''),
      keyInvestors: Array.isArray(parsed.keyInvestors) ? parsed.keyInvestors : [],
      mainProducts: Array.isArray(parsed.mainProducts) ? parsed.mainProducts : [],
      sources: searchResults.slice(0, 10).map(r => ({
        title: r.title,
        url: r.url,
        usedFor: '公司信息提取',
      })),
    };

    // Count non-empty fields
    const filledFields = countFilledFields(profile);
    const confidence: ProfileResult['confidence'] =
      filledFields.length >= 15 ? 'high' : filledFields.length >= 8 ? 'medium' : 'low';

    return { profile, confidence, filledFields };
  } catch (err) {
    return {
      profile: null,
      confidence: 'low',
      filledFields: [],
      error: err instanceof Error ? err.message : '分析失败',
    };
  }
}

function countFilledFields(profile: CompanyProfile): string[] {
  const filled: string[] = [];
  const checks: [string, unknown][] = [
    ['companyName', profile.companyName],
    ['businessDescription', profile.businessDescription],
    ['founded', profile.founded],
    ['headquarters', profile.headquarters],
    ['businessModel', profile.businessModel],
    ['website', profile.website],
    ['employeeCount', profile.employeeCount],
    ['revenue', profile.revenue],
    ['revenueGrowth', profile.revenueGrowth],
    ['grossMargin', profile.grossMargin],
    ['netIncome', profile.netIncome],
    ['ebitda', profile.ebitda],
    ['valuation', profile.valuation],
    ['totalFunding', profile.totalFunding],
    ['industry', profile.industry],
    ['tam', profile.tam],
    ['marketGrowth', profile.marketGrowth],
    ['latestRound', profile.latestRound],
    ['latestRoundAmount', profile.latestRoundAmount],
    ['keyInvestors', profile.keyInvestors],
  ];

  for (const [name, value] of checks) {
    if (value && value !== '' && value !== 'null' && value !== 'undefined') {
      if (Array.isArray(value) && value.length === 0) continue;
      filled.push(name);
    }
  }
  if (profile.founders.length > 0) filled.push('founders');
  if (profile.competitors.length > 0) filled.push('competitors');
  if (profile.mainProducts.length > 0) filled.push('mainProducts');

  return filled;
}
