import { loadResearchConfig, PROVIDER_PRESETS, type ResearchConfig } from '../research/research-adapter';
import type { RiskItemInput, RiskCategory } from '../engines/risk/risk-types';

export interface ExtractedFields {
  companyName: string; businessDescription: string; founded: string; headquarters: string;
  businessModel: string; website: string; milestones: string[];
  revenue: string; revenue2023: string; revenue2024: string; revenue2025: string;
  grossProfit: string; grossProfit2023: string; grossProfit2024: string; grossProfit2025: string;
  netIncome: string; netIncome2023: string; netIncome2024: string; netIncome2025: string;
  ebitda: string; grossMargin: string; grossMargin2024: string; grossMargin2025: string; netMargin: string;
  customerCount: string; employeeCount: string; rdStaffCount: string;
  team: { name: string; role: string; background: string; ownership: string; isKey: boolean }[];
  investors: { name: string; type: string; ownershipPct: string }[];
  products: { name: string; stage: string; revenuePct: string; description: string }[];
  ipPatents: string; rdPipeline: string;
  industry: string; tam: string; sam: string; som: string; marketGrowth: string;
  chainUp: string; chainMid: string; chainDown: string; keyTrends: string; entryBarriers: string;
  competitors: { name: string; stage: string; scale: string; advantage: string }[];
  competitiveAdvantage: string;
  sales: { customerName: string; businessLine: string; revenue2023: string; revenue2024: string; revenue2025: string; grossMargin: string; contractAmount: string; progress: string }[];
  procurement: { supplierName: string; category: string; amount2024: string; amount2025: string; contractDesc: string }[];
  financingRounds: { name: string; date: string; amount: string; preMoneyVal: string; postMoneyVal: string; investors: string }[];
  contracts: { name: string; party: string; amount: string; startDate: string; endDate: string; content: string }[];
  valFcf: string; valWacc: string; valGrowth: string; valEvRevenue: string;
  targetIrr: string; entryValuation: string; esopPct: string;
  exitValue: string; ownershipPct: string; holdingYears: string;
  rawOutput: string;
  customFields: Record<string, string>;
  riskFactors: string[];
  legalIssues: string;
  regulation: string;
}

// 4 focused small prompts — each has 10-15 fields, much higher extraction quality
const PASSES = [
  {
    name: '公司+团队',
    prompt: `提取公司信息和核心团队。只返回JSON：
{"companyName":"公司全称","businessDescription":"业务描述","founded":"成立时间","headquarters":"总部","businessModel":"商业模式","milestones":["里程碑"],
"team":[{"name":"姓名","role":"职位","background":"详细履历"}],
"investors":[{"name":"投资方","type":"类型","ownershipPct":"持股%"}],
"employeeCount":"员工总数","industry":"所属行业"}

文档：`,
  },
  {
    name: '财务+估值',
    prompt: `提取所有财务数字，分年份。只返回JSON：
{"revenue2023":"2023营收(万元)","revenue2024":"2024营收(万元)","revenue2025":"2025营收(万元)",
"grossProfit2023":"2023毛利","grossProfit2024":"2024毛利","grossProfit2025":"2025毛利",
"netIncome2023":"2023净利","netIncome2024":"2024净利","netIncome2025":"2025净利",
"ebitda":"EBITDA","grossMargin":"毛利率%","grossMargin2024":"2024毛利率","grossMargin2025":"2025毛利率","netMargin":"净利率%",
"valFcf":"FCF(万)","valWacc":"WACC","targetIrr":"目标IRR","entryValuation":"估值(万)","esopPct":"ESOP%",
"exitValue":"退出估值(万)","ownershipPct":"持股%","holdingYears":"持有年数"}

文档：`,
  },
  {
    name: '市场+竞品+产品',
    prompt: `提取行业市场规模、竞品、产品信息。只返回JSON：
{"tam":"TAM(万元)","sam":"SAM(万元)","som":"SOM(万元)","marketGrowth":"市场增速%",
"chainUp":"上游","chainMid":"产业链位置","chainDown":"下游","keyTrends":"趋势","entryBarriers":"壁垒",
"competitors":[{"name":"竞品","stage":"阶段","scale":"规模","advantage":"优势"}],
"competitiveAdvantage":"核心竞争优势",
"products":[{"name":"产品","stage":"研发/内测/已发布/规模化/成熟期","revenuePct":"收入占比%"}],
"ipPatents":"知识产权","rdPipeline":"研发管线"}

文档：`,
  },
  {
    name: '客户+采购+融资+合同',
    prompt: `提取客户销售、供应商、融资轮次、合同信息。只返回JSON：
{"sales":[{"customerName":"客户名","businessLine":"业务线","revenue2023":"2023收入","revenue2024":"2024收入","revenue2025":"2025收入","grossMargin":"毛利率%","contractAmount":"合同额"}],
"procurement":[{"supplierName":"供应商","category":"类别","amount2024":"2024金额","amount2025":"2025金额","contractDesc":"内容"}],
"financingRounds":[{"name":"轮次","date":"日期","amount":"金额(万)","preMoneyVal":"投前估值","postMoneyVal":"投后估值","investors":"投资方"}],
"contracts":[{"name":"合同","party":"对方","amount":"金额(万)","startDate":"开始","endDate":"结束","content":"内容"}]}

文档：`,
  },
  {
    name: '融资+估值+退出',
    prompt: `提取融资、估值、退出相关信息。只返回JSON：
{"financingRounds":[{"name":"轮次","date":"日期","amount":"金额(万)","preMoneyVal":"投前估值(万)","postMoneyVal":"投后估值(万)","investors":"投资方"}],
"valFcf":"FCF(万)","valWacc":"WACC","valGrowth":"永续增长率%","valEvRevenue":"EV/Revenue倍数",
"targetIrr":"目标IRR","entryValuation":"估值(万)","esopPct":"ESOP%",
"exitValue":"退出估值(万)","ownershipPct":"持股%","holdingYears":"持有年数",
"customFields":{"moic":"MOIC","dpi":"DPI","tvpi":"TVPI","irrRange":"IRR区间"}}

文档：`,
  },
  {
    name: '风险+合规+知识产权',
    prompt: `提取风险因素、法律合规、知识产权、研发和行业趋势。只返回JSON：
{"riskFactors":["风险1","风险2"],
"legalIssues":"法律合规问题简述",
"ipPatents":"知识产权详情(专利数量/核心技术)",
"rdPipeline":"研发管线(在研项目/技术路线)",
"keyTrends":"行业趋势/市场变化",
"entryBarriers":"进入壁垒(技术/资金/牌照)",
"regulation":"监管环境(适用法规/政策影响)"}

文档：`,
  },
];

function cleanJson(text: string): string {
  if (typeof text !== 'string') return '{}';
  let cleaned = text;
  // Remove R1 think blocks
  cleaned = cleaned.replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '');
  cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
  // Remove markdown code fences
  cleaned = cleaned.replace(/```json\s*/gi, '').replace(/```\s*/gi, '');
  // Find the LAST JSON object (R1 often outputs template first, then filled version)
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
  // If there are multiple JSON objects, take only the first complete one
  let depth = 0, firstEnd = -1;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === '{') depth++;
    else if (cleaned[i] === '}') { depth--; if (depth === 0) { firstEnd = i; break; } }
  }
  if (firstEnd > 0) cleaned = cleaned.slice(0, firstEnd + 1);
  // Clean up
  cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
  cleaned = cleaned.replace(/\/\/.*$/gm, '');
  return cleaned.trim();
}

function safeJsonParse(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return {};
  const cleaned = cleanJson(raw);
  try { const parsed = JSON.parse(cleaned); return (typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}

function safeNumber(value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    const cleaned = value.replace(/[,，\s]/g, '').replace(/[约近大约合超过不足]/g, '');
    const numMatch = cleaned.match(/[-+]?\d+\.?\d*/);
    if (!numMatch) return '';
    let num = parseFloat(numMatch[0]);
    if (isNaN(num)) return '';
    if (cleaned.includes('亿')) num *= 10000;
    return String(num);
  }
  return '';
}

function safeString(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function safeStrArr(value: unknown): string[] { return Array.isArray(value) ? value.map(v => safeString(v)).filter(Boolean) : []; }

async function callAI(endpoint: string, model: string, _systemMsg: string, userMsg: string, apiKey?: string): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  const maxTokens = model === 'deepseek-chat' ? 8192 : 16384;
  const resp = await fetch(endpoint, { method: 'POST', headers,
    body: JSON.stringify({ model, messages: [
      { role: 'system', content: '你必须且只能返回一个JSON对象。不要输出任何其他文字。不要markdown。不要解释。如果文档中没有对应信息，字段值设为空字符串""。' },
      { role: 'user', content: userMsg }], max_tokens: maxTokens, temperature: 0 }),
  });
  if (!resp.ok) throw new Error(`API ${resp.status}`);
  const data = await resp.json() as Record<string, unknown>;
  const content = (data.choices as Array<{ message: { content: unknown } }>)?.[0]?.message?.content;
  return typeof content === 'string' ? content : JSON.stringify(content || {});
}

export async function extractFieldsWithAI(
  documentText: string, config?: ResearchConfig,
): Promise<{ fields: ExtractedFields | null; error?: string }> {
  const cfg = config ?? loadResearchConfig();
  if (!cfg) return { fields: null, error: '请先配置AI模型。' };
  const preset = PROVIDER_PRESETS[cfg.provider] ?? PROVIDER_PRESETS.custom;
  const endpoint = cfg.endpoint || preset.endpoint || 'http://localhost:11434/v1/chat/completions';
  // Use larger model for better extraction (14B > 7B for complex docs)
  const model = cfg.model || (cfg.provider === 'ollama' ? 'deepseek-r1:14b' : 'deepseek-chat');
  // Use FULL document text (model has 64K+ context, no need to truncate)

  // Run 6 focused passes in parallel — each small prompt yields better quality
  const passResults = await Promise.allSettled(
    PASSES.map(p => callAI(endpoint, model, '', p.prompt + documentText, cfg.apiKey))
  );
  const merged: Record<string, unknown> = {};
  for (const r of passResults) {
    if (r.status === 'fulfilled') Object.assign(merged, safeJsonParse(r.value));
  }

  // Fallback: if all passes got too little, try one big prompt
  if (Object.keys(merged).length < 5) {
    const fbPrompt = `提取所有关键信息。输出JSON：{"companyName":"","founded":"","revenue2023":"","revenue2024":"","revenue2025":"","grossProfit":"","netIncome":"","grossMargin":"","team":[{"name":"","role":""}],"tam":"","marketGrowth":"","financingRounds":[],"exitValue":"","riskFactors":[],"legalIssues":""}\n\n文档：${documentText}`;
    try {
      const fb = await callAI(endpoint, model, '', fbPrompt, cfg.apiKey);
      const fbParsed = safeJsonParse(fb);
      if (Object.keys(fbParsed).length > Object.keys(merged).length) Object.assign(merged, fbParsed);
    } catch {}
  }

  if (Object.keys(merged).length === 0) return { fields: null, error: 'AI 未提取到任何字段。请检查 PDF 是否为文字型。' };

  // --- Post-processing: fill gaps with derived/computed values ---

  // Compute grossMargin from grossProfit / revenue if missing
  if ((!merged.grossMargin || safeNumber(merged.grossMargin) === '') && safeNumber(merged.grossProfit) !== '' && safeNumber(merged.revenue) !== '') {
    const gp = parseFloat(safeNumber(merged.grossProfit));
    const rev = parseFloat(safeNumber(merged.revenue));
    if (rev > 0 && !isNaN(gp) && !isNaN(rev)) {
      merged.grossMargin = String(Math.round((gp / rev) * 100 * 100) / 100);
    }
  }

  // Use revenue2025 as revenue if revenue itself is missing
  if ((!merged.revenue || safeNumber(merged.revenue) === '') && safeNumber(merged.revenue2025) !== '') {
    merged.revenue = safeNumber(merged.revenue2025);
  }

  // Auto-populate customer concentration risk from sales data
  if (Array.isArray(merged.sales) && merged.sales.length > 0) {
    const salesArr = merged.sales as Array<Record<string, unknown>>;
    const totalRevenue = salesArr.reduce((sum, s) => sum + parseFloat(safeNumber(s?.revenue2025) || safeNumber(s?.revenue2024) || '0'), 0);
    if (totalRevenue > 0) {
      const topCustomer = salesArr.reduce((max, s) => {
        const rev = parseFloat(safeNumber(s?.revenue2025) || safeNumber(s?.revenue2024) || '0');
        return rev > max ? rev : max;
      }, 0);
      const concentrationPct = Math.round((topCustomer / totalRevenue) * 100 * 100) / 100;
      if (concentrationPct > 20) {
        if (!Array.isArray(merged.riskFactors)) merged.riskFactors = [];
        (merged.riskFactors as string[]).push(`客户集中度风险：最大客户收入占比${concentrationPct}%`);
      }
    }
  }

  // TAM/SAM/SOM gap notes
  if (safeNumber(merged.tam) !== '' && (safeNumber(merged.sam) === '' || safeNumber(merged.som) === '')) {
    if (safeNumber(merged.sam) === '') merged.sam = '未提取到SAM，建议补充可服务市场估算';
    if (safeNumber(merged.som) === '') merged.som = '未提取到SOM，建议补充可获得市场估算';
  }

  // Team-based governance auto-notes
  if (Array.isArray(merged.team) && (merged.team as Array<unknown>).length > 0) {
    const teamArr = merged.team as Array<Record<string, unknown>>;
    const roles = teamArr.map(t => safeString(t?.role)).filter(Boolean);
    const founders = teamArr.filter(t => {
      const role = safeString(t?.role).toLowerCase();
      const bg = safeString(t?.background).toLowerCase();
      return role.includes('创始人') || role.includes('founder') || role.includes('ceo') || role.includes('创始') || bg.includes('创始人') || bg.includes('founder');
    });
    // Generate governance note if not extracted
    if (!merged.customFields) merged.customFields = {} as Record<string, string>;
    const cf = merged.customFields as Record<string, string>;
    if (!cf['governanceNote']) {
      cf['governanceNote'] = `团队共${teamArr.length}人，核心岗位：${roles.slice(0, 5).join('、')}` +
        (founders.length > 0 ? `；创始人/CEO：${founders.map(f => safeString(f?.name)).join('、')}` : '');
    }
  }

  // Risk factors from Pass 6 — ensure they're in merged.riskFactors
  if (Array.isArray(merged.riskFactors) && (merged.riskFactors as Array<unknown>).length > 0) {
    // Already populated by Pass 6; nothing extra needed
  } else if (!merged.riskFactors) {
    merged.riskFactors = [];
  }

  // --- End post-processing ---

  const fields: ExtractedFields = {
    companyName: safeString(merged.companyName), businessDescription: safeString(merged.businessDescription),
    founded: safeString(merged.founded), headquarters: safeString(merged.headquarters),
    businessModel: safeString(merged.businessModel), website: safeString(merged.website),
    milestones: safeStrArr(merged.milestones),
    revenue: safeNumber(merged.revenue), revenue2023: safeNumber(merged.revenue2023),
    revenue2024: safeNumber(merged.revenue2024), revenue2025: safeNumber(merged.revenue2025),
    grossProfit: safeNumber(merged.grossProfit), grossProfit2023: safeNumber(merged.grossProfit2023),
    grossProfit2024: safeNumber(merged.grossProfit2024), grossProfit2025: safeNumber(merged.grossProfit2025),
    netIncome: safeNumber(merged.netIncome), netIncome2023: safeNumber(merged.netIncome2023),
    netIncome2024: safeNumber(merged.netIncome2024), netIncome2025: safeNumber(merged.netIncome2025),
    ebitda: safeNumber(merged.ebitda), grossMargin: safeNumber(merged.grossMargin),
    grossMargin2024: safeNumber(merged.grossMargin2024), grossMargin2025: safeNumber(merged.grossMargin2025),
    netMargin: safeNumber(merged.netMargin), customerCount: safeNumber(merged.customerCount),
    employeeCount: safeNumber(merged.employeeCount), rdStaffCount: safeNumber(merged.rdStaffCount),
    team: Array.isArray(merged.team) ? merged.team.map((t: any) => ({ name: safeString(t?.name), role: safeString(t?.role), background: safeString(t?.background), ownership: safeString(t?.ownership), isKey: false })).filter((t: any) => t.name) : [],
    investors: Array.isArray(merged.investors) ? merged.investors.map((i: any) => ({ name: safeString(i?.name), type: safeString(i?.type), ownershipPct: safeString(i?.ownershipPct) })).filter((i: any) => i.name) : [],
    products: Array.isArray(merged.products) ? merged.products.map((p: any) => ({ name: safeString(p?.name), stage: safeString(p?.stage) || '已发布', revenuePct: safeString(p?.revenuePct), description: safeString(p?.description) })).filter((p: any) => p.name) : [],
    ipPatents: safeString(merged.ipPatents), rdPipeline: safeString(merged.rdPipeline),
    industry: safeString(merged.industry), tam: safeNumber(merged.tam), sam: safeNumber(merged.sam),
    som: safeNumber(merged.som), marketGrowth: safeNumber(merged.marketGrowth),
    chainUp: safeString(merged.chainUp), chainMid: safeString(merged.chainMid),
    chainDown: safeString(merged.chainDown), keyTrends: safeString(merged.keyTrends),
    entryBarriers: safeString(merged.entryBarriers),
    competitors: Array.isArray(merged.competitors) ? merged.competitors.map((c: any) => ({ name: safeString(c?.name), stage: safeString(c?.stage), scale: safeString(c?.scale), advantage: safeString(c?.advantage) })).filter((c: any) => c.name) : [],
    competitiveAdvantage: safeString(merged.competitiveAdvantage),
    sales: Array.isArray(merged.sales) ? merged.sales.map((s: any) => ({ customerName: safeString(s?.customerName), businessLine: safeString(s?.businessLine), revenue2023: safeNumber(s?.revenue2023), revenue2024: safeNumber(s?.revenue2024), revenue2025: safeNumber(s?.revenue2025), grossMargin: safeNumber(s?.grossMargin), contractAmount: safeNumber(s?.contractAmount), progress: safeString(s?.progress) })).filter((s: any) => s.customerName) : [],
    procurement: Array.isArray(merged.procurement) ? merged.procurement.map((p: any) => ({ supplierName: safeString(p?.supplierName), category: safeString(p?.category), amount2024: safeNumber(p?.amount2024), amount2025: safeNumber(p?.amount2025), contractDesc: safeString(p?.contractDesc) })).filter((p: any) => p.supplierName) : [],
    financingRounds: Array.isArray(merged.financingRounds) ? merged.financingRounds.map((r: any) => ({ name: safeString(r?.name), date: safeString(r?.date), amount: safeNumber(r?.amount), preMoneyVal: safeNumber(r?.preMoneyVal), postMoneyVal: safeNumber(r?.postMoneyVal), investors: safeString(r?.investors) })).filter((r: any) => r.name) : [],
    contracts: Array.isArray(merged.contracts) ? merged.contracts.map((c: any) => ({ name: safeString(c?.name), party: safeString(c?.party), amount: safeNumber(c?.amount), startDate: safeString(c?.startDate), endDate: safeString(c?.endDate), content: safeString(c?.content) })).filter((c: any) => c.name) : [],
    valFcf: safeNumber(merged.valFcf), valWacc: safeNumber(merged.valWacc),
    valGrowth: safeNumber(merged.valGrowth), valEvRevenue: safeNumber(merged.valEvRevenue),
    targetIrr: safeNumber(merged.targetIrr), entryValuation: safeNumber(merged.entryValuation),
    esopPct: safeNumber(merged.esopPct), exitValue: safeNumber(merged.exitValue),
    ownershipPct: safeNumber(merged.ownershipPct), holdingYears: safeNumber(merged.holdingYears),
    rawOutput: JSON.stringify(merged),
    customFields: (merged.customFields as Record<string, string>) || {},
    riskFactors: safeStrArr(merged.riskFactors),
    legalIssues: safeString(merged.legalIssues),
    regulation: safeString(merged.regulation),
  };
  return { fields };
}

export function applyExtractedFields(fields: ExtractedFields, projectId: string): string[] {
  const applied: string[] = [];
  const a = (label: string) => { if (!applied.includes(label)) applied.push(label); };
  // Clear old data
  const modules = ['company-overview','financials','team-members','industry','products','competitors','sales','procurement','financing-history','contracts','valuation','exit','ip','rd','esop','invest','quality','assumptions','bearcase','strategy','risk-items'];
  modules.forEach(m => localStorage.removeItem(`dd-p-${projectId}-${m}`));
  // Save extraction summary for persistence across navigation
  localStorage.setItem(`dd-p-${projectId}-extraction-time`, new Date().toISOString());
  const getObj = (m: string) => { try { const raw = localStorage.getItem(`dd-p-${projectId}-${m}`); if (!raw) return {}; const p = JSON.parse(raw); return (p && typeof p === 'object' && !Array.isArray(p)) ? p as Record<string,unknown> : {}; } catch { return {}; } };
  const setObj = (m: string, d: unknown) => localStorage.setItem(`dd-p-${projectId}-${m}`, JSON.stringify(d));

  // Company
  const company = getObj('company-overview');
  if (fields.companyName) { company.name = fields.companyName; a('公司名称'); }
  if (fields.businessDescription) { company.description = fields.businessDescription; a('业务描述'); }
  if (fields.founded) { company.founded = fields.founded; a('成立时间'); }
  if (fields.headquarters) { company.headquarters = fields.headquarters; a('总部'); }
  if (fields.businessModel) { company.businessModel = fields.businessModel; a('商业模式'); }
  if (fields.website) { company.website = fields.website; a('网站'); }
  if (fields.milestones.length > 0) { company.milestones = fields.milestones; a('里程碑'); }
  setObj('company-overview', company);

  // Financials — auto-derive totals from year data if missing
  const fin: Record<string, string> = {};
  // Revenue: use total if available, otherwise latest year
  fin.revenue = fields.revenue || fields.revenue2025 || fields.revenue2024 || fields.revenue2023 || '';
  if (fin.revenue) a('营收');
  if (fields.revenue2023) fin['revenue2023'] = fields.revenue2023;
  if (fields.revenue2024) fin['revenue2024'] = fields.revenue2024;
  if (fields.revenue2025) fin['revenue2025'] = fields.revenue2025;
  // Gross profit
  fin.grossProfit = fields.grossProfit || fields.grossProfit2025 || fields.grossProfit2024 || fields.grossProfit2023 || '';
  if (fin.grossProfit) a('毛利');
  if (fields.grossProfit2023) fin['grossProfit2023'] = fields.grossProfit2023;
  if (fields.grossProfit2024) fin['grossProfit2024'] = fields.grossProfit2024;
  if (fields.grossProfit2025) fin['grossProfit2025'] = fields.grossProfit2025;
  // Net income
  fin.netIncome = fields.netIncome || fields.netIncome2025 || fields.netIncome2024 || fields.netIncome2023 || '';
  if (fin.netIncome) a('净利润');
  if (fields.netIncome2023) fin['netIncome2023'] = fields.netIncome2023;
  if (fields.netIncome2024) fin['netIncome2024'] = fields.netIncome2024;
  if (fields.netIncome2025) fin['netIncome2025'] = fields.netIncome2025;
  if (fields.ebitda) { fin.ebitda = fields.ebitda; a('EBITDA'); }
  if (fields.employeeCount) fin['employeeCount'] = fields.employeeCount;
  // Margin: use latest year
  fin.grossMargin = fields.grossMargin || fields.grossMargin2025 || fields.grossMargin2024 || '';
  if (fin.grossMargin) a('毛利率');
  if (fields.grossMargin2024) fin['grossMargin2024'] = fields.grossMargin2024;
  if (fields.grossMargin2025) fin['grossMargin2025'] = fields.grossMargin2025;
  setObj('financials', fin);

  // Team
  if (fields.team.length > 0) {
    setObj('team-members', fields.team.map(t => ({ id: crypto.randomUUID(), name: t.name, role: t.role, background: t.background, ownership: t.ownership, isKey: false })));
    a(`团队(${fields.team.length}人)`);
  }

  // Industry
  const ind: Record<string, string> = {};
  if (fields.tam) { ind.tam = fields.tam; a('TAM'); }
  if (fields.sam) ind.sam = fields.sam;
  if (fields.som) ind.som = fields.som;
  if (fields.marketGrowth) { ind.growthRate = fields.marketGrowth; a('市场增速'); }
  if (fields.chainUp) ind.chainUp = fields.chainUp;
  if (fields.chainMid) { ind.chainMid = fields.chainMid; a('产业链'); }
  if (fields.chainDown) ind.chainDown = fields.chainDown;
  if (fields.keyTrends) ind.trends = fields.keyTrends;
  if (fields.industry) ind.industry = fields.industry;
  setObj('industry', ind);

  // Products
  if (fields.products.length > 0) {
    setObj('products', fields.products.map(p => ({ name: p.name, stage: p.stage, revenuePct: p.revenuePct, moat: p.description })));
    a(`产品(${fields.products.length}个)`);
  }
  if (fields.ipPatents) { localStorage.setItem(`dd-p-${projectId}-ip`, fields.ipPatents); a('IP'); }
  if (fields.rdPipeline) { localStorage.setItem(`dd-p-${projectId}-rd`, fields.rdPipeline); a('研发'); }

  // Competitors
  if (fields.competitors.length > 0) {
    setObj('competitors', fields.competitors.map(c => ({ name: c.name, stage: c.stage, scale: c.scale, pricing: '', share: '', diff: c.advantage, funding: '' })));
    a(`竞品(${fields.competitors.length}个)`);
  }

  // Sales
  if (fields.sales.length > 0) {
    setObj('sales', fields.sales.map(s => ({ name: s.customerName, businessLine: s.businessLine, revenue2023: s.revenue2023, revenue2024: s.revenue2024, revenue2025: s.revenue2025, grossMargin: s.grossMargin, contractAmount: s.contractAmount, progress: s.progress })));
    a(`销售(${fields.sales.length}条)`);
  }

  // Procurement
  if (fields.procurement.length > 0) {
    setObj('procurement', fields.procurement.map(p => ({ name: p.supplierName, category: p.category, amount2023: '', amount2024: p.amount2024, amount2025: p.amount2025, contractDesc: p.contractDesc })));
    a(`采购(${fields.procurement.length}条)`);
  }

  // Financing
  if (fields.financingRounds.length > 0) {
    setObj('financing-history', fields.financingRounds.map(r => ({ name: r.name, date: r.date, amount: r.amount, preMoneyVal: r.preMoneyVal, postMoneyVal: r.postMoneyVal, investors: r.investors })));
    a(`融资(${fields.financingRounds.length}轮)`);
  }

  // Contracts
  if (fields.contracts.length > 0) {
    setObj('contracts', fields.contracts.map(c => ({ id: crypto.randomUUID(), name: c.name, party: c.party, amount: c.amount, startDate: c.startDate, endDate: c.endDate, content: c.content, progress: '' })));
    a(`合同(${fields.contracts.length}份)`);
  }

  // Valuation
  const val: Record<string, string> = {};
  if (fields.valFcf) { val.fcfBase = fields.valFcf; a('FCF'); }
  if (fields.valWacc) val.wacc = fields.valWacc;
  if (fields.valGrowth) val.terminalGrowth = fields.valGrowth;
  if (fields.targetIrr) val.targetIrr = fields.targetIrr;
  if (fields.entryValuation) { val.entryValuation = fields.entryValuation; a('估值'); }
  setObj('valuation', val);

  if (fields.esopPct) { localStorage.setItem(`dd-p-${projectId}-esop`, fields.esopPct); a('ESOP'); }
  if (fields.entryValuation) { localStorage.setItem(`dd-p-${projectId}-invest`, fields.entryValuation); }

  // Exit — auto-compute MOIC/IRR from exit data
  const ex: Record<string, string> = {};
  if (fields.exitValue) { ex.exitValue = fields.exitValue; a('退出估值'); }
  if (fields.ownershipPct) ex.ownershipPct = fields.ownershipPct;
  if (fields.holdingYears) ex.holdingYears = fields.holdingYears;
  // Auto-compute MOIC = exitValue * ownershipPct / entryValuation (if both exist)
  if (fields.exitValue && fields.entryValuation) {
    const exitVal = parseFloat(fields.exitValue);
    const entryVal = parseFloat(fields.entryValuation);
    const ownership = fields.ownershipPct ? parseFloat(fields.ownershipPct) / 100 : 1;
    if (!isNaN(exitVal) && !isNaN(entryVal) && entryVal > 0) {
      const moic = Math.round((exitVal * ownership) / entryVal * 100) / 100;
      ex.moic = String(moic);
      a('MOIC');
      // Estimate IRR from MOIC if holdingYears available
      if (fields.holdingYears) {
        const years = parseFloat(fields.holdingYears);
        if (!isNaN(years) && years > 0 && moic > 0) {
          const irr = Math.round((Math.pow(moic, 1 / years) - 1) * 10000) / 100;
          ex.irr = String(irr);
        }
      }
    }
  }
  if (fields.targetIrr) { ex.targetIrr = fields.targetIrr; }
  setObj('exit', ex);

  // Risk items — from Pass 6 riskFactors + auto-derived
  const riskItems: RiskItemInput[] = [];
  if (fields.riskFactors && fields.riskFactors.length > 0) {
    fields.riskFactors.forEach((rf) => {
      let cat: RiskCategory = 'market';
      const lower = rf.toLowerCase();
      if (lower.includes('市场') || lower.includes('竞争') || lower.includes('需求')) cat = 'market';
      else if (lower.includes('技术') || lower.includes('研发') || lower.includes('专利')) cat = 'technology';
      else if (lower.includes('财务') || lower.includes('资金') || lower.includes('现金流')) cat = 'financial';
      else if (lower.includes('客户') || lower.includes('集中') || lower.includes('依赖')) cat = 'customer';
      else if (lower.includes('法律') || lower.includes('合规') || lower.includes('监管') || lower.includes('政策')) cat = 'legal_compliance';
      else if (lower.includes('团队') || lower.includes('人才') || lower.includes('管理') || lower.includes('创始')) cat = 'governance';
      else if (lower.includes('供应链') || lower.includes('供应商') || lower.includes('原材料')) cat = 'financial';
      else if (lower.includes('退出') || lower.includes('上市') || lower.includes('IPO')) cat = 'exit';
      riskItems.push({ riskId: crypto.randomUUID(), category: cat, title: rf, probability: '0.4', impact: '0.5', mitigationEffectiveness: '0.15' });
    });
  }
  if (riskItems.length > 0) { setObj('risk-items', riskItems); a(`风险项(${riskItems.length}条)`); }
  if (fields.legalIssues) {
    riskItems.push({ riskId: crypto.randomUUID(), category: 'legal_compliance', title: fields.legalIssues, probability: '0.35', impact: '0.6', mitigationEffectiveness: '0.2' });
    setObj('risk-items', riskItems); a('法律合规');
  }

  // Strategy / regulation / barriers / trends
  const strategy: Record<string, string> = {};
  if (fields.regulation) { strategy.regulation = fields.regulation; a('监管环境'); }
  if (fields.entryBarriers) { strategy.entryBarriers = fields.entryBarriers; a('进入壁垒'); }
  if (fields.keyTrends) { strategy.keyTrends = fields.keyTrends; a('行业趋势'); }
  if (fields.competitiveAdvantage) { strategy.competitiveAdvantage = fields.competitiveAdvantage; a('竞争优势'); }
  if (Object.keys(strategy).length > 0) setObj('strategy', strategy);

  // Financial quality — auto-compute Revenue CAGR from year data
  if (fields.revenue2023 && fields.revenue2025) {
    const rev23 = parseFloat(fields.revenue2023);
    const rev25 = parseFloat(fields.revenue2025);
    if (!isNaN(rev23) && !isNaN(rev25) && rev23 > 0) {
      const cagr = Math.round((Math.pow(rev25 / rev23, 1 / 2) - 1) * 10000) / 100;
      const quality = getObj('quality');
      quality['revenueCagr'] = String(cagr);
      // Quality score: simple heuristic based on growth + margins
      const gm = parseFloat(fields.grossMargin || fields.grossMargin2025 || fields.grossMargin2024 || '0');
      const nm = parseFloat(fields.netMargin || '0');
      let score = 50; // baseline
      if (cagr > 30) score += 15;
      else if (cagr > 15) score += 10;
      else if (cagr > 5) score += 5;
      else if (cagr < 0) score -= 10;
      if (!isNaN(gm) && gm > 60) score += 10;
      else if (!isNaN(gm) && gm > 30) score += 5;
      if (!isNaN(nm) && nm > 15) score += 10;
      else if (!isNaN(nm) && nm > 5) score += 5;
      else if (!isNaN(nm) && nm < 0) score -= 10;
      quality['score'] = String(Math.max(0, Math.min(100, score)));
      setObj('quality', quality);
      a('营收CAGR');
    }
  }

  // Governance notes from team data
  if (fields.team && fields.team.length > 0) {
    const govNote = fields.customFields?.['governanceNote'] ||
      `核心团队${fields.team.length}人：${fields.team.map(t => `${t.name}(${t.role})`).slice(0, 5).join('、')}`;
    const quality = getObj('quality');
    if (!quality['governanceNote']) {
      quality['governanceNote'] = govNote;
      setObj('quality', quality);
    }
  }

  // Custom fields — elastic extraction for any structured info not covered above
  if (fields.customFields && Object.keys(fields.customFields).length > 0) {
    localStorage.setItem(`dd-p-${projectId}-custom-fields`, JSON.stringify(fields.customFields));
    a(`自定义字段(${Object.keys(fields.customFields).length}项)`);
  }

  // Persist the summary so dashboard can display it
  localStorage.setItem(`dd-p-${projectId}-extraction-summary`, JSON.stringify({
    count: applied.length,
    items: applied,
    time: new Date().toISOString(),
  }));
  return applied;
}

export function getExtractionSummary(projectId: string): { count: number; items: string[]; time: string } | null {
  try {
    const raw = localStorage.getItem(`dd-p-${projectId}-extraction-summary`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
