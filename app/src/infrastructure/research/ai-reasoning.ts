/**
 * AI-powered comprehensive investment analysis.
 * Collects ALL data from all modules, sends to AI for reasoning,
 * returns structured investment conclusions.
 */
import { loadResearchConfig, PROVIDER_PRESETS, type ResearchConfig } from './research-adapter';

export interface AnalysisContext {
  company: Record<string, unknown>;
  team: unknown[];
  industry: Record<string, unknown>;
  competitors: unknown[];
  products: unknown[];
  financials: Record<string, unknown>;
  sales: unknown[];
  procurement: unknown[];
  financingHistory: unknown[];
  contracts: unknown[];
  riskItems: unknown[];
  valuation: Record<string, unknown>;
  exit: Record<string, unknown>;
  qualityScores: Record<string, unknown>;
  strategy: string;
  assumptions: string[];
  bearCase: string;
}

export interface AIReasoningResult {
  investmentThesis: string;        // 投资逻辑
  keyHighlights: string[];        // 核心亮点
  keyRisks: { risk: string; mitigation: string }[]; // 风险及应对
  competitivePosition: string;    // 竞争地位
  valuationOpinion: string;       // 估值判断
  growthOutlook: string;          // 增长前景
  teamAssessment: string;         // 团队评估
  businessModelQuality: string;   // 商业模式质量
  recommendation: string;         // 投资建议
  keyConditions: string[];        // 投资先决条件
  riskLevel: '低' | '中' | '高';  // 综合风险等级
  convictionLevel: '高' | '中' | '低'; // 信心水平
  rawOutput: string;
}

function collectAllContext(projectId: string): AnalysisContext {
  const safeJson = (module: string, fallback: unknown = {}) => {
    try { const v = localStorage.getItem(`dd-p-${projectId}-${module}`); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  };
  const safeStr = (module: string, fallback = '') => localStorage.getItem(`dd-p-${projectId}-${module}`) || fallback;
  return {
    company: safeJson('company-overview', {}),
    team: safeJson('team-members', []),
    industry: safeJson('industry', {}),
    competitors: safeJson('competitors', []),
    products: safeJson('products', []),
    financials: safeJson('financials', {}),
    sales: safeJson('sales', []),
    procurement: safeJson('procurement', []),
    financingHistory: safeJson('financing-history', []),
    contracts: safeJson('contracts', []),
    riskItems: safeJson('risk-items', []),
    valuation: safeJson('valuation', {}),
    exit: safeJson('exit', {}),
    qualityScores: safeJson('quality', {}),
    strategy: safeStr('strategy', 'growth'),
    assumptions: safeStr('assumptions', '').split('\n').filter(Boolean),
    bearCase: safeStr('bearcase', ''),
  };
}

const REASONING_PROMPT = `你是一位资深一级市场投资合伙人（VC/PE），正在审核一份投资尽调项目。请基于以下所有数据，从专业投资者角度给出综合分析。

## 要求
1. 用中文输出，观点明确，有理有据
2. 每个结论必须引用具体数据支撑
3. 不要编造不存在的信息
4. 如果某个维度数据不足，明确指出"数据不足，无法判断"

## 输出格式（严格按此结构，JSON）：
{
  "investmentThesis": "300字以内的投资逻辑总结，说明为什么投/为什么不投",
  "keyHighlights": ["亮点1", "亮点2", "亮点3"],
  "keyRisks": [{"risk": "具体风险", "mitigation": "建议应对措施"}],
  "competitivePosition": "100字竞争地位分析",
  "valuationOpinion": "100字估值合理性判断",
  "growthOutlook": "100字增长前景分析",
  "teamAssessment": "100字团队评估",
  "businessModelQuality": "100字商业模式质量评价",
  "recommendation": "最终投资建议（强烈推荐/有条件投资/继续观察/暂缓/不投资）及一句话理由",
  "keyConditions": ["投资先决条件1", "条件2"],
  "riskLevel": "低/中/高",
  "convictionLevel": "高/中/低"
}

## 项目数据
`;

function cleanJson(text: string): string {
  let cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
  return cleaned;
}

export async function runAIReasoning(projectId: string, config?: ResearchConfig): Promise<{ result: AIReasoningResult | null; error?: string }> {
  const cfg = config ?? loadResearchConfig();
  if (!cfg) return { result: null, error: '请先配置AI模型。' };

  const preset = PROVIDER_PRESETS[cfg.provider] ?? PROVIDER_PRESETS.custom;
  const endpoint = cfg.endpoint || preset.endpoint || 'http://localhost:11434/v1/chat/completions';
  const model = cfg.model || preset.defaultModel || 'deepseek-r1-distill-qwen-7b:latest';

  const context = collectAllContext(projectId);
  const contextStr = JSON.stringify(context, null, 2);

  // Truncate if too long (keep under ~12000 chars for the data portion)
  const maxContextLen = 12000;
  const truncated = contextStr.length > maxContextLen ? contextStr.slice(0, maxContextLen) + '\n...(truncated)' : contextStr;

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

    const response = await fetch(endpoint, {
      method: 'POST', headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你是一位资深一级市场投资合伙人。用中文回复，只输出有效的JSON。' },
          { role: 'user', content: REASONING_PROMPT + truncated },
        ],
        max_tokens: 4000,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      return { result: null, error: `API error (${response.status}): ${err.slice(0, 200)}` };
    }

    const data = await response.json() as Record<string, unknown>;
    const choices = data.choices as Array<{ message: { content: string } }> | undefined;
    const content = choices?.[0]?.message?.content;
    if (!content) return { result: null, error: 'AI 返回空响应' };

    const parsed = JSON.parse(cleanJson(content)) as Record<string, unknown>;

    return {
      result: {
        investmentThesis: String(parsed.investmentThesis || ''),
        keyHighlights: Array.isArray(parsed.keyHighlights) ? parsed.keyHighlights.map(String) : [],
        keyRisks: Array.isArray(parsed.keyRisks) ? parsed.keyRisks.map((r: any) => ({ risk: String(r.risk||''), mitigation: String(r.mitigation||'') })) : [],
        competitivePosition: String(parsed.competitivePosition || ''),
        valuationOpinion: String(parsed.valuationOpinion || ''),
        growthOutlook: String(parsed.growthOutlook || ''),
        teamAssessment: String(parsed.teamAssessment || ''),
        businessModelQuality: String(parsed.businessModelQuality || ''),
        recommendation: String(parsed.recommendation || ''),
        keyConditions: Array.isArray(parsed.keyConditions) ? parsed.keyConditions.map(String) : [],
        riskLevel: (['低','中','高'] as const).includes(parsed.riskLevel as any) ? parsed.riskLevel as '低'|'中'|'高' : '中',
        convictionLevel: (['高','中','低'] as const).includes(parsed.convictionLevel as any) ? parsed.convictionLevel as '高'|'中'|'低' : '中',
        rawOutput: content,
      },
    };
  } catch (err) {
    return { result: null, error: err instanceof Error ? err.message : 'AI 推理失败' };
  }
}
