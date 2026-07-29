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

const PROMPT = `你是一级市场投资尽调助手。从以下文档文本中提取所有可识别的结构化信息。找不到的字段留空字符串""或空数组[]。只返回合法JSON，不要解释。

{
  "companyName":"公司全称","businessDescription":"业务描述","founded":"成立时间",
  "headquarters":"总部","businessModel":"商业模式","website":"网站","milestones":["里程碑"],
  "revenue":"总营收(万元)","revenue2023":"2023营收(万元)","revenue2024":"2024营收(万元)","revenue2025":"2025营收(万元)",
  "grossProfit":"毛利(万元)","netIncome":"净利润(万元)","ebitda":"EBITDA(万元)",
  "grossMargin":"毛利率%","netMargin":"净利率%","customerCount":"客户数","employeeCount":"员工数","rdStaffCount":"研发人数",
  "team":[{"name":"姓名","role":"职位","background":"详细履历","ownership":"持股%","isKey":true}],
  "investors":[{"name":"投资方","type":"产业资本/财务投资","ownershipPct":"持股%"}],
  "products":[{"name":"产品名","stage":"研发/内测/已发布/规模化/成熟期","revenuePct":"收入占比%","description":"描述"}],
  "ipPatents":"知识产权","rdPipeline":"研发管线",
  "industry":"行业","tam":"TAM(万元)","sam":"SAM(万元)","som":"SOM(万元)","marketGrowth":"市场增速%",
  "chainUp":"上游","chainMid":"公司位置","chainDown":"下游","keyTrends":"趋势","entryBarriers":"壁垒",
  "competitors":[{"name":"竞品","stage":"融资阶段","scale":"规模","advantage":"优势"}],
  "competitiveAdvantage":"核心优势",
  "sales":[{"customerName":"客户名","businessLine":"业务线(端侧智能-汽车/端侧智能-手机/法律智能/教育智能/政企定制/海外/其他)","revenue2023":"2023收入","revenue2024":"2024收入","revenue2025":"2025收入","grossMargin":"毛利率%","contractAmount":"合同额","progress":"进度%"}],
  "procurement":[{"supplierName":"供应商","category":"类别(算力租赁/数据采购/云服务/技术服务外包/法律服务/房租物业/硬件采购/其他)","amount2024":"2024金额","amount2025":"2025金额","contractDesc":"合同内容"}],
  "financingRounds":[{"name":"轮次","date":"日期","amount":"金额(万元)","preMoneyVal":"投前估值","postMoneyVal":"投后估值","investors":"投资方"}],
  "contracts":[{"name":"合同名称","party":"对方","amount":"金额(万元)","startDate":"开始","endDate":"结束","content":"内容"}],
  "valFcf":"基准FCF(万元)","valWacc":"WACC(小数)","valGrowth":"永续增长率(小数)","valEvRevenue":"EV/Revenue",
  "targetIrr":"目标IRR(小数)","entryValuation":"进入估值(万元)","esopPct":"ESOP%",
  "exitValue":"退出估值(万元)","ownershipPct":"持股%","holdingYears":"持有年数"
}
文档文本：`;

function cleanJson(text: string): string {
  let cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
  cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
  cleaned = cleaned.replace(/\/\/.*$/gm, '');
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
  return cleaned.trim();
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
  documentText: string, config?: ResearchConfig,
): Promise<{ fields: ExtractedFields | null; error?: string }> {
  const cfg = config ?? loadResearchConfig();
  if (!cfg) return { fields: null, error: '请先配置AI模型。' };
  const preset = PROVIDER_PRESETS[cfg.provider] ?? PROVIDER_PRESETS.custom;
  const endpoint = cfg.endpoint || preset.endpoint || 'http://localhost:11434/v1/chat/completions';
  const model = cfg.model || preset.defaultModel || 'deepseek-r1-distill-qwen-7b:latest';
  const truncated = documentText.slice(0, 8000);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

  const doFetch = async (strict: boolean): Promise<Record<string, unknown>> => {
    const sysMsg = strict ? '只输出合法JSON。不要任何其他文字。' : '你是一个精确的数据提取助手。只返回合法JSON。';
    const userMsg = strict ? PROMPT + truncated + '\n重要：只输出JSON。确保无尾逗号、字符串正确转义。' : PROMPT + truncated;
    const resp = await fetch(endpoint, { method: 'POST', headers,
      body: JSON.stringify({ model, messages: [{ role: 'system', content: sysMsg }, { role: 'user', content: userMsg }], max_tokens: 8000, temperature: strict ? 0 : 0.1 }),
    });
    if (!resp.ok) throw new Error(`API ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    console.log('AI API response:', JSON.stringify(data).slice(0, 500));
    const rawContent = (data.choices as Array<{ message: { content: unknown } }>)?.[0]?.message?.content;
    if (!rawContent) throw new Error('Empty response');
    const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
    console.log('AI content type:', typeof rawContent, 'length:', content.length);
    try { return JSON.parse(cleanJson(content)) as Record<string, unknown>; }
    catch (err) {
      console.error('JSON parse failed. Content:', content.slice(0, 500));
      if (strict) throw new Error(`Parse fail: ${content.slice(0,300)}`); throw new Error('retry');
    }
  };

  let parsed: Record<string, unknown>;
  try {
    parsed = await doFetch(false);
  } catch (err) {
    if (err instanceof Error && err.message === 'retry') {
      try { parsed = await doFetch(true); }
      catch (e2) { return { fields: null, error: e2 instanceof Error ? e2.message : 'JSON解析失败' }; }
    } else {
      return { fields: null, error: err instanceof Error ? err.message : 'AI请求失败' };
    }
  }

  const fields: ExtractedFields = {
    companyName: safeString(parsed.companyName), businessDescription: safeString(parsed.businessDescription),
    founded: safeString(parsed.founded), headquarters: safeString(parsed.headquarters),
    businessModel: safeString(parsed.businessModel), website: safeString(parsed.website),
    milestones: Array.isArray(parsed.milestones) ? parsed.milestones.map(safeString).filter(Boolean) : [],
    revenue: safeNumber(parsed.revenue), revenue2023: safeNumber(parsed.revenue2023),
    revenue2024: safeNumber(parsed.revenue2024), revenue2025: safeNumber(parsed.revenue2025),
    grossProfit: safeNumber(parsed.grossProfit), netIncome: safeNumber(parsed.netIncome),
    ebitda: safeNumber(parsed.ebitda), grossMargin: safeNumber(parsed.grossMargin),
    netMargin: safeNumber(parsed.netMargin), customerCount: safeNumber(parsed.customerCount),
    employeeCount: safeNumber(parsed.employeeCount), rdStaffCount: safeNumber(parsed.rdStaffCount),
    team: Array.isArray(parsed.team) ? parsed.team.map((t: any) => ({ name: safeString(t?.name), role: safeString(t?.role), background: safeString(t?.background), ownership: safeString(t?.ownership), isKey: t?.isKey === true })).filter((t: any) => t.name) : [],
    investors: Array.isArray(parsed.investors) ? parsed.investors.map((i: any) => ({ name: safeString(i?.name), type: safeString(i?.type), ownershipPct: safeString(i?.ownershipPct) })).filter((i: any) => i.name) : [],
    products: Array.isArray(parsed.products) ? parsed.products.map((p: any) => ({ name: safeString(p?.name), stage: safeString(p?.stage) || '已发布', revenuePct: safeString(p?.revenuePct), description: safeString(p?.description) })).filter((p: any) => p.name) : [],
    ipPatents: safeString(parsed.ipPatents), rdPipeline: safeString(parsed.rdPipeline),
    industry: safeString(parsed.industry), tam: safeNumber(parsed.tam), sam: safeNumber(parsed.sam),
    som: safeNumber(parsed.som), marketGrowth: safeNumber(parsed.marketGrowth),
    chainUp: safeString(parsed.chainUp), chainMid: safeString(parsed.chainMid),
    chainDown: safeString(parsed.chainDown), keyTrends: safeString(parsed.keyTrends),
    entryBarriers: safeString(parsed.entryBarriers),
    competitors: Array.isArray(parsed.competitors) ? parsed.competitors.map((c: any) => ({ name: safeString(c?.name), stage: safeString(c?.stage), scale: safeString(c?.scale), advantage: safeString(c?.advantage) })).filter((c: any) => c.name) : [],
    competitiveAdvantage: safeString(parsed.competitiveAdvantage),
    sales: Array.isArray(parsed.sales) ? parsed.sales.map((s: any) => ({ customerName: safeString(s?.customerName), businessLine: safeString(s?.businessLine), revenue2023: safeNumber(s?.revenue2023), revenue2024: safeNumber(s?.revenue2024), revenue2025: safeNumber(s?.revenue2025), grossMargin: safeNumber(s?.grossMargin), contractAmount: safeNumber(s?.contractAmount), progress: safeString(s?.progress) })).filter((s: any) => s.customerName) : [],
    procurement: Array.isArray(parsed.procurement) ? parsed.procurement.map((p: any) => ({ supplierName: safeString(p?.supplierName), category: safeString(p?.category), amount2024: safeNumber(p?.amount2024), amount2025: safeNumber(p?.amount2025), contractDesc: safeString(p?.contractDesc) })).filter((p: any) => p.supplierName) : [],
    financingRounds: Array.isArray(parsed.financingRounds) ? parsed.financingRounds.map((r: any) => ({ name: safeString(r?.name), date: safeString(r?.date), amount: safeNumber(r?.amount), preMoneyVal: safeNumber(r?.preMoneyVal), postMoneyVal: safeNumber(r?.postMoneyVal), investors: safeString(r?.investors) })).filter((r: any) => r.name) : [],
    contracts: Array.isArray(parsed.contracts) ? parsed.contracts.map((c: any) => ({ name: safeString(c?.name), party: safeString(c?.party), amount: safeNumber(c?.amount), startDate: safeString(c?.startDate), endDate: safeString(c?.endDate), content: safeString(c?.content) })).filter((c: any) => c.name) : [],
    valFcf: safeNumber(parsed.valFcf), valWacc: safeNumber(parsed.valWacc),
    valGrowth: safeNumber(parsed.valGrowth), valEvRevenue: safeNumber(parsed.valEvRevenue),
    targetIrr: safeNumber(parsed.targetIrr), entryValuation: safeNumber(parsed.entryValuation),
    esopPct: safeNumber(parsed.esopPct), exitValue: safeNumber(parsed.exitValue),
    ownershipPct: safeNumber(parsed.ownershipPct), holdingYears: safeNumber(parsed.holdingYears),
    rawOutput: JSON.stringify(parsed),
  };
  return { fields };
}

export function applyExtractedFields(fields: ExtractedFields, projectId: string): string[] {
  const applied: string[] = [];
  const a = (label: string) => { if (!applied.includes(label)) applied.push(label); };
  const pkey = (m: string) => `dd-p-${projectId}-${m}`;
  const getStore = (m: string) => { try { return JSON.parse(localStorage.getItem(pkey(m)) || '{}'); } catch { return {}; } };
  const setStore = (m: string, d: unknown) => localStorage.setItem(pkey(m), JSON.stringify(d));

  const company: Record<string, unknown> = getStore('company-overview');
  if (fields.companyName) { company.name = fields.companyName; a('公司名称'); }
  if (fields.businessDescription) { company.description = fields.businessDescription; a('业务描述'); }
  if (fields.founded) { company.founded = fields.founded; a('成立时间'); }
  if (fields.headquarters) { company.headquarters = fields.headquarters; a('总部'); }
  if (fields.businessModel) { company.businessModel = fields.businessModel; a('商业模式'); }
  if (fields.website) { company.website = fields.website; a('网站'); }
  if (fields.milestones.length > 0) { company.milestones = fields.milestones; a('里程碑'); }
  setStore(pkey('company-overview'), JSON.stringify(company));

  const fin: Record<string, string> = JSON.parse(getStore(pkey('financials')) || '{}');
  const sf = (k: string, v: string, l: string) => { if (v) { fin[k] = v; a(l); } };
  sf('revenue', fields.revenue, '营收'); sf('grossProfit', fields.grossProfit, '毛利');
  sf('netIncome', fields.netIncome, '净利润'); sf('ebitda', fields.ebitda, 'EBITDA');
  sf('customerCount', fields.customerCount, '客户数');
  setStore(pkey('financials'), JSON.stringify(fin));

  if (fields.team.length > 0) {
    setStore(pkey('team-members'), JSON.stringify(fields.team.map(t => ({ id: crypto.randomUUID(), name: t.name, role: t.role, background: t.background, ownership: t.ownership, isKey: t.isKey }))));
    a(`团队(${fields.team.length}人)`);
  }

  const ind: Record<string, string> = JSON.parse(getStore(pkey('industry')) || '{}');
  const si = (k: string, v: string, l: string) => { if (v) { ind[k] = v; a(l); } };
  si('tam', fields.tam, 'TAM'); si('sam', fields.sam, 'SAM'); si('som', fields.som, 'SOM');
  si('growthRate', fields.marketGrowth, '市场增速'); si('chainUp', fields.chainUp, '产业链');
  si('chainMid', fields.chainMid, '公司位置'); si('chainDown', fields.chainDown, '下游');
  si('trends', fields.keyTrends, '趋势');
  setStore(pkey('industry'), JSON.stringify(ind));

  if (fields.products.length > 0) {
    setStore(pkey('products'), JSON.stringify(fields.products.map(p => ({ name: p.name, stage: p.stage, revenuePct: p.revenuePct, moat: p.description }))));
    a(`产品(${fields.products.length}个)`);
  }
  if (fields.ipPatents) { setStore(pkey('ip'), fields.ipPatents); a('IP'); }
  if (fields.rdPipeline) { setStore(pkey('rd'), fields.rdPipeline); a('研发'); }

  if (fields.competitors.length > 0) {
    setStore(pkey('competitors'), JSON.stringify(fields.competitors.map(c => ({ name: c.name, stage: c.stage, scale: c.scale, pricing: '', share: '', diff: c.advantage, funding: '' }))));
    a(`竞品(${fields.competitors.length}个)`);
  }

  if (fields.sales.length > 0) {
    setStore(pkey('sales'), JSON.stringify(fields.sales.map(s => ({ name: s.customerName, businessLine: s.businessLine, revenue2023: s.revenue2023, revenue2024: s.revenue2024, revenue2025: s.revenue2025, grossMargin: s.grossMargin, contractAmount: s.contractAmount, progress: s.progress }))));
    a(`销售(${fields.sales.length}条)`);
  }

  if (fields.procurement.length > 0) {
    setStore(pkey('procurement'), JSON.stringify(fields.procurement.map(p => ({ name: p.supplierName, category: p.category, amount2023: '', amount2024: p.amount2024, amount2025: p.amount2025, contractDesc: p.contractDesc }))));
    a(`采购(${fields.procurement.length}条)`);
  }

  if (fields.financingRounds.length > 0) {
    setStore(pkey('financing-history'), JSON.stringify(fields.financingRounds.map(r => ({ name: r.name, date: r.date, amount: r.amount, preMoneyVal: r.preMoneyVal, postMoneyVal: r.postMoneyVal, investors: r.investors }))));
    a(`融资(${fields.financingRounds.length}轮)`);
  }

  if (fields.contracts.length > 0) {
    setStore(pkey('contracts'), JSON.stringify(fields.contracts.map(c => ({ id: crypto.randomUUID(), name: c.name, party: c.party, amount: c.amount, startDate: c.startDate, endDate: c.endDate, content: c.content, progress: '' }))));
    a(`合同(${fields.contracts.length}份)`);
  }

  const val: Record<string, string> = JSON.parse(getStore(pkey('valuation')) || '{}');
  if (fields.valFcf) { val.fcfBase = fields.valFcf; a('FCF'); }
  if (fields.valWacc) { val.wacc = fields.valWacc; a('WACC'); }
  if (fields.valGrowth) { val.terminalGrowth = fields.valGrowth; a('增长率'); }
  if (fields.targetIrr) { val.targetIrr = fields.targetIrr; a('目标IRR'); }
  if (fields.entryValuation) { val.entryValuation = fields.entryValuation; a('估值'); }
  setStore(pkey('valuation'), JSON.stringify(val));

  if (fields.esopPct) { setStore(pkey('esop'), fields.esopPct); a('ESOP'); }
  if (fields.entryValuation) { setStore(pkey('invest'), fields.entryValuation); }

  const ex: Record<string, string> = JSON.parse(getStore(pkey('exit')) || '{}');
  if (fields.exitValue) { ex.exitValue = fields.exitValue; a('退出估值'); }
  if (fields.ownershipPct) { ex.ownershipPct = fields.ownershipPct; a('持股'); }
  if (fields.holdingYears) { ex.holdingYears = fields.holdingYears; a('持有期'); }
  setStore(pkey('exit'), JSON.stringify(ex));

  return applied;
}
