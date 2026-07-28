/**
 * AI-powered field extraction from document text.
 * Sends extracted PDF/PPTX text to AI API, gets back structured fields.
 * User must configure an API key in Settings → AI Research first.
 */
import { loadResearchConfig, PROVIDER_PRESETS, type ResearchConfig } from '../research/research-adapter';

export interface ExtractedFields {
  companyName: string;
  businessDescription: string;
  founded: string;
  revenue: string;
  grossProfit: string;
  netIncome: string;
  ebitda: string;
  operatingCashFlow: string;
  customerCount: string;
  arpu: string;
  arr: string;
  team: { name: string; role: string }[];
  milestones: string[];
  competitors: { name: string; description: string }[];
  products: { name: string; stage: string }[];
  tam: string;
  marketGrowth: string;
  rawOutput: string;
}

const PROMPT = `You are extracting structured fields from an investment due diligence document.

Extract as many of these fields as possible from the text below. Use "N/A" for fields not found.

Return ONLY valid JSON (no markdown, no explanation):
{
  "companyName": "",
  "businessDescription": "",
  "founded": "",
  "revenue": "(number only, in 10k CNY/万人民币. e.g. 5000 for 5000万)",
  "grossProfit": "(number only, or empty)",
  "netIncome": "(number only, or empty)",
  "ebitda": "(number only, or empty)",
  "operatingCashFlow": "(number only, or empty)",
  "customerCount": "(number only, or empty)",
  "arpu": "(number only, or empty)",
  "arr": "(number only, or empty)",
  "team": [{"name": "...", "role": "CEO/CTO/..."}],
  "milestones": ["milestone 1", "milestone 2"],
  "competitors": [{"name": "...", "description": "..."}],
  "products": [{"name": "...", "stage": "R&D/Beta/Released/Scale/Mature"}],
  "tam": "(market size number only, or empty)",
  "marketGrowth": "(growth rate %, or empty)"
}

Document text:
`;

function cleanJson(text: string): string {
  // Remove markdown code fences if present
  let cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
  return cleaned;
}

function safeNumber(value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    const cleaned = value.replace(/[,，\s]/g, '').replace(/万/g, '').replace(/亿/g, '0000');
    const num = parseFloat(cleaned);
    return isNaN(num) ? '' : String(num);
  }
  return '';
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function extractFieldsWithAI(
  documentText: string,
  config?: ResearchConfig,
): Promise<{ fields: ExtractedFields | null; error?: string }> {
  const cfg = config ?? loadResearchConfig();
  if (!cfg) return { fields: null, error: '请先在 AI 研究中心配置 API Key。' };

  const preset = PROVIDER_PRESETS[cfg.provider] ?? PROVIDER_PRESETS.custom;
  const endpoint = cfg.endpoint || preset.endpoint || 'https://api.openai.com/v1/chat/completions';
  const model = cfg.model || preset.defaultModel || 'gpt-4o-mini';

  // Truncate text to ~8000 chars to stay within token limits
  const truncated = documentText.slice(0, 8000);

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a precise data extraction assistant. Return ONLY valid JSON.' },
          { role: 'user', content: PROMPT + truncated },
        ],
        max_tokens: 3000,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      return { fields: null, error: `API error (${response.status}): ${err.slice(0, 200)}` };
    }

    const data = await response.json() as Record<string, unknown>;
    const choices = data.choices as Array<{ message: { content: string } }> | undefined;
    const content = choices?.[0]?.message?.content;
    if (!content) return { fields: null, error: 'AI returned empty response.' };

    const parsed = JSON.parse(cleanJson(content)) as Record<string, unknown>;

    const fields: ExtractedFields = {
      companyName: safeString(parsed.companyName),
      businessDescription: safeString(parsed.businessDescription),
      founded: safeString(parsed.founded),
      revenue: safeNumber(parsed.revenue),
      grossProfit: safeNumber(parsed.grossProfit),
      netIncome: safeNumber(parsed.netIncome),
      ebitda: safeNumber(parsed.ebitda),
      operatingCashFlow: safeNumber(parsed.operatingCashFlow),
      customerCount: safeNumber(parsed.customerCount),
      arpu: safeNumber(parsed.arpu),
      arr: safeNumber(parsed.arr),
      team: Array.isArray(parsed.team) ? parsed.team.map((t: any) => ({ name: safeString(t?.name), role: safeString(t?.role) })).filter((t: any) => t.name) : [],
      milestones: Array.isArray(parsed.milestones) ? parsed.milestones.map((m: any) => safeString(m)).filter(Boolean) : [],
      competitors: Array.isArray(parsed.competitors) ? parsed.competitors.map((c: any) => ({ name: safeString(c?.name), description: safeString(c?.description) })).filter((c: any) => c.name) : [],
      products: Array.isArray(parsed.products) ? parsed.products.map((p: any) => ({ name: safeString(p?.name), stage: safeString(p?.stage) || 'Released' })).filter((p: any) => p.name) : [],
      tam: safeNumber(parsed.tam),
      marketGrowth: safeNumber(parsed.marketGrowth),
      rawOutput: content,
    };

    return { fields };
  } catch (err) {
    return { fields: null, error: err instanceof Error ? err.message : 'AI extraction failed.' };
  }
}

export function applyExtractedFields(fields: ExtractedFields): string[] {
  const applied: string[] = [];

  // Company overview
  if (fields.companyName || fields.businessDescription) {
    const existing = JSON.parse(localStorage.getItem('dd-company-overview') || '{}');
    if (fields.companyName) { existing.name = fields.companyName; applied.push('公司名称'); }
    if (fields.businessDescription) { existing.description = fields.businessDescription; applied.push('业务描述'); }
    if (fields.founded) { existing.founded = fields.founded; applied.push('成立时间'); }
    if (fields.milestones.length > 0) { existing.milestones = fields.milestones; applied.push('里程碑'); }
    localStorage.setItem('dd-company-overview', JSON.stringify(existing));
  }

  // Financial
  const finFields: Record<string, string> = {};
  if (fields.revenue) { finFields.revenue = fields.revenue; applied.push('营业收入'); }
  if (fields.grossProfit) { finFields.grossProfit = fields.grossProfit; applied.push('毛利'); }
  if (fields.netIncome) { finFields.netIncome = fields.netIncome; applied.push('净利润'); }
  if (fields.ebitda) { finFields.ebitda = fields.ebitda; applied.push('EBITDA'); }
  if (fields.operatingCashFlow) { finFields.operatingCashFlow = fields.operatingCashFlow; applied.push('经营现金流'); }
  if (fields.customerCount) { finFields.customerCount = fields.customerCount; applied.push('客户数'); }
  if (fields.arpu) { finFields.arpu = fields.arpu; applied.push('ARPU'); }
  if (fields.arr) { finFields.arr = fields.arr; applied.push('ARR'); }
  if (Object.keys(finFields).length > 0) {
    const existing = JSON.parse(localStorage.getItem('dd-financial-v3') || '{}');
    localStorage.setItem('dd-financial-v3', JSON.stringify({ ...existing, ...finFields }));
  }

  // Team
  if (fields.team.length > 0) {
    const members = fields.team.map((t) => ({ id: crypto.randomUUID(), name: t.name, role: t.role, background: '', ownership: '', isKey: true }));
    localStorage.setItem('dd-team-members', JSON.stringify(members));
    applied.push(`团队(${members.length}人)`);
  }

  // Industry
  if (fields.tam || fields.marketGrowth) {
    const existing = JSON.parse(localStorage.getItem('dd-industry-v2') || '{}');
    if (fields.tam) { existing.tam = fields.tam; applied.push('TAM'); }
    if (fields.marketGrowth) { existing.growthRate = fields.marketGrowth; applied.push('市场增速'); }
    localStorage.setItem('dd-industry-v2', JSON.stringify(existing));
  }

  // Competitors
  if (fields.competitors.length > 0) {
    const comps = fields.competitors.map((c) => ({ name: c.name, stage: '', scale: '', pricing: '', share: '', diff: c.description, funding: '' }));
    localStorage.setItem('dd-competitors-v2', JSON.stringify(comps));
    applied.push(`竞品(${comps.length}个)`);
  }

  // Products
  if (fields.products.length > 0) {
    const prods = fields.products.map((p) => ({ name: p.name, stage: p.stage, revenuePct: '', moat: '' }));
    localStorage.setItem('dd-products-v2', JSON.stringify(prods));
    applied.push(`产品(${prods.length}个)`);
  }

  return applied;
}
