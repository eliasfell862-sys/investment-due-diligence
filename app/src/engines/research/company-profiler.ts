/**
 * Company Profiler — AI-powered company research
 *
 * Uses the customer's ALREADY-CONFIGURED AI model to research companies.
 * No additional search API key needed. The AI model draws from its training
 * data which covers most known companies.
 *
 * Optionally accepts web search snippets to augment accuracy.
 */

import { loadResearchConfig, PROVIDER_PRESETS } from '../../infrastructure/research/research-adapter';
import type { SearchResult } from '../../infrastructure/search/search-adapter';

// ── Types ──

export interface CompanyProfile {
  companyName: string; businessDescription: string; founded: string;
  headquarters: string; businessModel: string; website: string; employeeCount: string;
  revenue: string; revenueGrowth: string; grossMargin: string; netIncome: string; ebitda: string;
  valuation: string; totalFunding: string;
  founders: { name: string; role: string; background: string }[];
  industry: string; tam: string; marketGrowth: string;
  competitors: { name: string; description: string }[];
  latestRound: string; latestRoundAmount: string; latestRoundDate: string;
  keyInvestors: string[];
  mainProducts: { name: string; description: string }[];
}

export interface ProfileResult {
  readonly profile: CompanyProfile | null;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly filledFields: string[];
  readonly error?: string;
  readonly knowledgeCutoff?: string;
}

// ── AI call helper ──

async function callAI(userPrompt: string): Promise<string> {
  const cfg = loadResearchConfig();
  if (!cfg) throw new Error('请先在 AI 研究页面配置 AI 模型。');

  const preset = PROVIDER_PRESETS[cfg.provider] ?? PROVIDER_PRESETS.custom;
  const endpoint = cfg.endpoint || preset.endpoint || 'http://localhost:11434/v1/chat/completions';
  const model = cfg.model || (cfg.provider === 'ollama' ? 'deepseek-r1:14b' : 'deepseek-chat');
  const maxTokens = cfg.provider === 'ollama' ? 8192 : 16384;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

  const resp = await fetch(endpoint, {
    method: 'POST', headers,
    body: JSON.stringify({
      model, messages: [
        { role: 'system', content: '你是投资研究助手。基于你的知识提供公司信息。不知道的字段用 null。只返回 JSON，不要 markdown，不要解释。' },
        { role: 'user', content: userPrompt },
      ], max_tokens: maxTokens, temperature: 0.1,
    }),
  });
  if (!resp.ok) throw new Error(`AI API 错误 ${resp.status}`);
  const data = await resp.json() as Record<string, unknown>;
  const content = (data.choices as Array<{ message: { content: unknown } }>)?.[0]?.message?.content;
  return typeof content === 'string' ? content : JSON.stringify(content || {});
}

function parseAIJson(raw: string): Record<string, unknown> {
  let t = raw;
  t = t.replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '');
  t = t.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
  t = t.replace(/```json\s*/gi, '').replace(/```\s*/gi, '');
  t = t.replace(/"/g, '"').replace(/"/g, '"');
  t = t.replace(/，/g, ',').replace(/：/g, ':');

  const start = t.indexOf('{');
  if (start < 0) return {};

  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) end = t.lastIndexOf('}');
  if (end <= start) return {};
  t = t.slice(start, end + 1);

  try { return JSON.parse(t); } catch {
    try { return JSON.parse(t.replace(/(\{|\,)\s*(\w+)\s*\:/g, '$1"$2":')); } catch { return {}; }
  }
}

// ── Main profiling ──

export async function profileCompany(
  companyName: string,
  webResults?: readonly SearchResult[],
): Promise<ProfileResult> {
  const queries = [
    // Query 1: Basic info + team + market
    `请提供关于"${companyName}"的以下信息，不知道的填null：

{
  "companyName": "公司全称",
  "businessDescription": "一句话业务描述",
  "founded": "成立年份",
  "headquarters": "总部城市",
  "businessModel": "商业模式",
  "website": "官网URL",
  "employeeCount": "员工数量",
  "industry": "所属行业细分",
  "founders": [{"name":"姓名","role":"职位","background":"背景简述"}],
  "mainProducts": [{"name":"产品/服务名","description":"简述"}],
  "competitors": [{"name":"竞品名","description":"简述"}]
}`,

    // Query 2: Financials
    `请提供关于"${companyName}"的财务和融资信息，不知道的填null：

{
  "revenue": "最新年度营收(万元人民币，纯数字)",
  "revenueGrowth": "营收增速(百分比数字，如25)",
  "grossMargin": "毛利率(百分比数字，如60)",
  "netIncome": "净利润(万元)",
  "ebitda": "EBITDA(万元)",
  "valuation": "最新估值(万元)",
  "totalFunding": "累计融资总额(万元)",
  "latestRound": "最新融资轮次(如A轮/B轮/C轮/战略投资)",
  "latestRoundAmount": "最新轮次金额(万元)",
  "latestRoundDate": "最新轮次日期(如2024-06)",
  "keyInvestors": ["投资方1","投资方2"]
}`,

    // Query 3: Market
    `请提供关于"${companyName}"的市场信息，不知道的填null：

{
  "tam": "所在市场TAM(万元人民币)",
  "marketGrowth": "市场年增速(百分比数字，如20)",
  "industry": "行业分类",
  "businessDescription": "详细业务描述(100字)",
  "mainProducts": [{"name":"核心产品","description":"产品详情"}],
  "competitors": [{"name":"主要竞品","description":"竞品优势"}]
}`
  ];

  // If web results available, append them
  const webContext = webResults && webResults.length > 0
    ? `\n\n【网络搜索结果参考】\n${webResults.map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}`).join('\n\n')}`
    : '';

  const merged: Record<string, unknown> = {};

  for (let i = 0; i < queries.length; i++) {
    try {
      const prompt = queries[i] + webContext;
      const result = await callAI(prompt);
      const parsed = parseAIJson(result);
      // Smart merge: don't overwrite non-empty with empty
      for (const [key, val] of Object.entries(parsed)) {
        const existing = merged[key];
        const newIsEmpty = val === null || val === '' || val === undefined ||
          (Array.isArray(val) && val.length === 0);
        const existingIsEmpty = existing === null || existing === '' || existing === undefined ||
          (Array.isArray(existing) && existing.length === 0);
        if (existing === undefined || (existingIsEmpty && !newIsEmpty)) {
          merged[key] = val;
        } else if (!newIsEmpty && Array.isArray(val) && Array.isArray(existing)) {
          merged[key] = [...existing, ...val];
        }
      }
    } catch { /* continue to next query */ }
  }

  if (Object.keys(merged).length === 0) {
    return { profile: null, confidence: 'low', filledFields: [], error: 'AI 未返回有效信息。可能是模型知识库中缺少该公司数据。' };
  }

  const profile: CompanyProfile = {
    companyName: String(merged.companyName || companyName),
    businessDescription: String(merged.businessDescription || ''),
    founded: String(merged.founded || ''),
    headquarters: String(merged.headquarters || ''),
    businessModel: String(merged.businessModel || ''),
    website: String(merged.website || ''),
    employeeCount: String(merged.employeeCount || ''),
    revenue: String(merged.revenue || ''),
    revenueGrowth: String(merged.revenueGrowth || ''),
    grossMargin: String(merged.grossMargin || ''),
    netIncome: String(merged.netIncome || ''),
    ebitda: String(merged.ebitda || ''),
    valuation: String(merged.valuation || ''),
    totalFunding: String(merged.totalFunding || ''),
    founders: Array.isArray(merged.founders) ? merged.founders : [],
    industry: String(merged.industry || ''),
    tam: String(merged.tam || ''),
    marketGrowth: String(merged.marketGrowth || ''),
    competitors: Array.isArray(merged.competitors) ? merged.competitors : [],
    latestRound: String(merged.latestRound || ''),
    latestRoundAmount: String(merged.latestRoundAmount || ''),
    latestRoundDate: String(merged.latestRoundDate || ''),
    keyInvestors: Array.isArray(merged.keyInvestors) ? merged.keyInvestors : [],
    mainProducts: Array.isArray(merged.mainProducts) ? merged.mainProducts : [],
  };

  const filled = countFilled(profile);
  const confidence: ProfileResult['confidence'] =
    filled.length >= 12 ? 'high' : filled.length >= 6 ? 'medium' : 'low';

  return { profile, confidence, filledFields: filled };
}

function countFilled(p: CompanyProfile): string[] {
  const filled: string[] = [];
  const checks: [string, unknown][] = [
    ['companyName', p.companyName], ['businessDescription', p.businessDescription],
    ['founded', p.founded], ['headquarters', p.headquarters],
    ['businessModel', p.businessModel], ['website', p.website],
    ['employeeCount', p.employeeCount], ['revenue', p.revenue],
    ['revenueGrowth', p.revenueGrowth], ['grossMargin', p.grossMargin],
    ['netIncome', p.netIncome], ['ebitda', p.ebitda],
    ['valuation', p.valuation], ['totalFunding', p.totalFunding],
    ['industry', p.industry], ['tam', p.tam],
    ['marketGrowth', p.marketGrowth], ['latestRound', p.latestRound],
    ['latestRoundAmount', p.latestRoundAmount], ['keyInvestors', p.keyInvestors],
  ];
  for (const [name, value] of checks) {
    if (value && value !== '' && value !== 'null' && value !== 'undefined') {
      if (Array.isArray(value) && value.length === 0) continue;
      filled.push(name);
    }
  }
  if (p.founders.length > 0) filled.push('founders');
  if (p.competitors.length > 0) filled.push('competitors');
  if (p.mainProducts.length > 0) filled.push('mainProducts');
  return filled;
}
