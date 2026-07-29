import { loadResearchConfig, PROVIDER_PRESETS, type ResearchConfig } from '../research/research-adapter';

export interface ExtractedFields {
  companyName: string; businessDescription: string; founded: string; headquarters: string;
  businessModel: string; website: string; milestones: string[];
  revenue: string; revenue2023: string; revenue2024: string; revenue2025: string;
  grossProfit: string; netIncome: string; ebitda: string; grossMargin: string; netMargin: string;
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
}

// 3 focused passes — each smaller so the model can be thorough
const PASSES = [
  {
    name: '公司信息+财务+团队',
    prompt: `提取公司基本信息、财务数据和核心团队。只返回JSON：
{"companyName":"公司全称","businessDescription":"业务描述","founded":"成立时间","headquarters":"总部","businessModel":"商业模式","website":"网站","milestones":["里程碑"],
"revenue":"总营收(万元)","revenue2023":"2023营收","revenue2024":"2024营收","revenue2025":"2025营收",
"grossProfit":"毛利(万元)","netIncome":"净利润(万元)","ebitda":"EBITDA(万元)","grossMargin":"毛利率%",
"employeeCount":"员工数","rdStaffCount":"研发人数",
"team":[{"name":"姓名","role":"职位","background":"履历","ownership":"持股%"}],
"investors":[{"name":"投资方","type":"类型","ownershipPct":"持股%"}],
"industry":"行业","tam":"TAM(万元)","sam":"SAM(万元)","som":"SOM(万元)","marketGrowth":"市场增速%"}

文档：`,
  },
  {
    name: '产品+竞品+产业链',
    prompt: `提取产品、竞品、产业链信息。只返回JSON：
{"products":[{"name":"产品名","stage":"研发/内测/已发布/规模化/成熟期","revenuePct":"收入占比%","description":"描述"}],
"ipPatents":"知识产权","rdPipeline":"研发管线",
"competitors":[{"name":"竞品","stage":"融资阶段","scale":"规模","advantage":"优势"}],
"competitiveAdvantage":"核心优势",
"chainUp":"上游","chainMid":"公司位置","chainDown":"下游","keyTrends":"趋势","entryBarriers":"壁垒"}

文档：`,
  },
  {
    name: '客户销售+采购+融资+合同',
    prompt: `提取客户销售数据、采购、融资历史、合同信息。只返回JSON：
{"sales":[{"customerName":"客户名","businessLine":"业务线(端侧智能-汽车/端侧智能-手机/法律智能/教育智能/政企定制/海外/其他)","revenue2023":"2023收入(万)","revenue2024":"2024收入(万)","revenue2025":"2025收入(万)","grossMargin":"毛利率%","contractAmount":"合同额(万)"}],
"procurement":[{"supplierName":"供应商","category":"类别(算力租赁/数据采购/云服务/技术服务外包/法律服务/房租物业/硬件采购/其他)","amount2024":"2024金额(万)","amount2025":"2025金额(万)","contractDesc":"内容"}],
"financingRounds":[{"name":"轮次","date":"日期","amount":"金额(万)","preMoneyVal":"投前估值(万)","postMoneyVal":"投后估值(万)","investors":"投资方"}],
"contracts":[{"name":"合同名称","party":"对方","amount":"金额(万)","startDate":"开始","endDate":"结束","content":"内容"}],
"valFcf":"FCF(万元)","valWacc":"WACC","targetIrr":"目标IRR","entryValuation":"估值(万)","esopPct":"ESOP%","exitValue":"退出估值(万)","ownershipPct":"持股%","holdingYears":"持有年数"}

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

async function callAI(endpoint: string, model: string, systemMsg: string, userMsg: string, apiKey?: string): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  const resp = await fetch(endpoint, { method: 'POST', headers,
    body: JSON.stringify({ model, messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: userMsg }], max_tokens: 6000, temperature: 0 }),
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
  // Use coding model for structured extraction (R1 is for reasoning)
  const model = cfg.provider === 'ollama' ? 'qwen2.5-coder:7b' : (cfg.model || preset.defaultModel || 'qwen2.5-coder:7b');
  const truncated = documentText.slice(0, 6000);

  // Run all 3 passes in parallel
  const passResults = await Promise.allSettled(
    PASSES.map(pass => callAI(endpoint, model, '你是一个精确的数据提取助手。只返回合法JSON。', pass.prompt + truncated, cfg.apiKey))
  );

  // Merge all pass results
  const merged: Record<string, unknown> = {};
  for (const result of passResults) {
    if (result.status === 'fulfilled') {
      const parsed = safeJsonParse(result.value);
      Object.assign(merged, parsed);
    }
  }

  if (Object.keys(merged).length === 0) return { fields: null, error: 'AI 未提取到任何字段。请检查 PDF 是否为文字型。' };

  const fields: ExtractedFields = {
    companyName: safeString(merged.companyName), businessDescription: safeString(merged.businessDescription),
    founded: safeString(merged.founded), headquarters: safeString(merged.headquarters),
    businessModel: safeString(merged.businessModel), website: safeString(merged.website),
    milestones: safeStrArr(merged.milestones),
    revenue: safeNumber(merged.revenue), revenue2023: safeNumber(merged.revenue2023),
    revenue2024: safeNumber(merged.revenue2024), revenue2025: safeNumber(merged.revenue2025),
    grossProfit: safeNumber(merged.grossProfit), netIncome: safeNumber(merged.netIncome),
    ebitda: safeNumber(merged.ebitda), grossMargin: safeNumber(merged.grossMargin),
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
  };
  console.log('extractFieldsWithAI result: fields with data =', Object.entries(fields).filter(([k,v]) => {
    if (Array.isArray(v)) return v.length > 0;
    return v && v !== '';
  }).map(([k]) => k));
  return { fields };
}

export function applyExtractedFields(fields: ExtractedFields, projectId: string): string[] {
  console.log('applyExtractedFields called with projectId:', projectId);
  console.log('fields keys with data:', Object.entries(fields).filter(([k,v]) => {
    if (Array.isArray(v)) return v.length > 0;
    return v && v !== '';
  }).map(([k]) => k));
  const applied: string[] = [];
  const a = (label: string) => { if (!applied.includes(label)) applied.push(label); };
  // Clear old data
  const modules = ['company-overview','financials','team-members','industry','products','competitors','sales','procurement','financing-history','contracts','valuation','exit','ip','rd','esop','invest','quality','assumptions','bearcase','strategy'];
  modules.forEach(m => localStorage.removeItem(`dd-p-${projectId}-${m}`));
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

  // Financials
  const fin: Record<string, string> = {};
  if (fields.revenue) { fin.revenue = fields.revenue; a('营收'); }
  if (fields.revenue2023) fin['revenue2023'] = fields.revenue2023;
  if (fields.revenue2024) fin['revenue2024'] = fields.revenue2024;
  if (fields.revenue2025) fin['revenue2025'] = fields.revenue2025;
  if (fields.grossProfit) { fin.grossProfit = fields.grossProfit; a('毛利'); }
  if (fields.netIncome) { fin.netIncome = fields.netIncome; a('净利润'); }
  if (fields.ebitda) { fin.ebitda = fields.ebitda; a('EBITDA'); }
  if (fields.employeeCount) fin['employeeCount'] = fields.employeeCount;
  if (fields.grossMargin) fin['grossMargin'] = fields.grossMargin;
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

  // Exit
  const ex: Record<string, string> = {};
  if (fields.exitValue) { ex.exitValue = fields.exitValue; a('退出估值'); }
  if (fields.ownershipPct) ex.ownershipPct = fields.ownershipPct;
  if (fields.holdingYears) ex.holdingYears = fields.holdingYears;
  setObj('exit', ex);

  return applied;
}
