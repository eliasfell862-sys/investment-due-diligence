/**
 * Company Profiler — Comprehensive AI-powered company research
 *
 * 10 focused AI queries covering every analysis module:
 * 1. Company Overview + Milestones
 * 2. Team + Governance
 * 3. Industry + Market + Regulation
 * 4. Competitors + Competitive Position
 * 5. Products + Technology + IP + R&D
 * 6. Financials (P&L, Cash Flow, Unit Economics)
 * 7. Valuation + Exit
 * 8. Financing History + Cap Table
 * 9. Sales + Customers + Procurement + Contracts
 * 10. Risk Factors + Legal + Red Flags
 *
 * Zero additional API config — uses customer's existing AI setup.
 */

import { loadResearchConfig, PROVIDER_PRESETS } from '../../infrastructure/research/research-adapter';

// ── Comprehensive Profile Type ──

export interface CompanyProfile {
  // Module 1: Company Overview
  companyName: string; businessDescription: string; founded: string;
  headquarters: string; businessModel: string; website: string;
  employeeCount: string; milestones: string[];

  // Module 2: Team
  founders: { name: string; role: string; background: string; ownership: string }[];
  keyExecutives: { name: string; role: string; background: string }[];

  // Module 3: Industry & Market
  industry: string; subIndustry: string;
  tam: string; sam: string; som: string; marketGrowth: string;
  chainUp: string; chainMid: string; chainDown: string;
  keyTrends: string; entryBarriers: string; regulation: string;

  // Module 4: Competitors
  competitors: { name: string; stage: string; scale: string; funding: string; advantage: string }[];
  competitiveAdvantage: string;

  // Module 5: Products & Technology
  mainProducts: { name: string; stage: string; revenuePct: string; description: string }[];
  ipPatents: string; rdPipeline: string;

  // Module 6: Financials
  revenue: string; revenue2023: string; revenue2024: string; revenue2025: string;
  grossProfit: string; grossProfit2023: string; grossProfit2024: string; grossProfit2025: string;
  netIncome: string; netIncome2023: string; netIncome2024: string; netIncome2025: string;
  ebitda: string; grossMargin: string; netMargin: string;
  operatingCashFlow: string; freeCashFlow: string; cashBalance: string; burnRate: string;
  customerCount: string; arpu: string; cac: string; ltv: string;
  arr: string; nrr: string;

  // Module 7: Valuation & Exit
  valuation: string; totalFunding: string;
  valFcf: string; valWacc: string; valGrowth: string;
  targetIrr: string; entryValuation: string; esopPct: string;
  exitValue: string; ownershipPct: string; holdingYears: string;

  // Module 8: Financing History
  latestRound: string; latestRoundAmount: string; latestRoundDate: string;
  keyInvestors: string[];
  financingRounds: { name: string; date: string; amount: string; preMoneyVal: string; postMoneyVal: string; investors: string }[];

  // Module 9: Sales, Procurement, Contracts
  sales: { customerName: string; businessLine: string; revenue2024: string; revenue2025: string; grossMargin: string }[];
  procurement: { supplierName: string; category: string; amount2024: string; amount2025: string }[];
  contracts: { name: string; party: string; amount: string; startDate: string; endDate: string; content: string }[];

  // Module 10: Risk
  riskFactors: string[];
  legalIssues: string;
}

export interface ProfileResult {
  readonly profile: CompanyProfile | null;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly filledFields: string[];
  readonly moduleCoverage: { module: string; fields: number }[];
  readonly error?: string;
}

// ── AI Helpers ──

async function callAI(userPrompt: string): Promise<string> {
  const cfg = loadResearchConfig();
  if (!cfg) throw new Error('请先在 AI 研究页面配置 AI 模型。');
  const preset = PROVIDER_PRESETS[cfg.provider] ?? PROVIDER_PRESETS.custom;
  const endpoint = cfg.endpoint || preset.endpoint;
  const model = cfg.model || (cfg.provider === 'ollama' ? 'deepseek-r1:14b' : 'deepseek-chat');
  const maxTokens = cfg.provider === 'ollama' ? 8192 : 16384;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
  const resp = await fetch(endpoint, {
    method: 'POST', headers,
    body: JSON.stringify({ model, messages: [
      { role: 'system', content: '你是投资尽调研究助手。基于你对公司的知识提供信息。不知道的填 null。必须只返回 JSON，不要 markdown，不要解释。' },
      { role: 'user', content: userPrompt },
    ], max_tokens: maxTokens, temperature: 0.1 }),
  });
  if (!resp.ok) throw new Error(`AI API ${resp.status}`);
  const data = await resp.json() as Record<string, unknown>;
  const content = (data.choices as Array<{ message: { content: unknown } }>)?.[0]?.message?.content;
  return typeof content === 'string' ? content : '{}';
}

function parseJson(raw: string): Record<string, unknown> {
  let t = raw;
  t = t.replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '');
  t = t.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
  t = t.replace(/```json\s*/gi, '').replace(/```\s*/gi, '');
  t = t.replace(/"/g, '"').replace(/"/g, '"').replace(/，/g, ',').replace(/：/g, ':');
  const s = t.indexOf('{');
  if (s < 0) return {};
  let d = 0, inS = false, esc = false, e = -1;
  for (let i = s; i < t.length; i++) {
    const c = t[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inS = !inS; continue; }
    if (inS) continue;
    if (c === '{') d++; else if (c === '}') { d--; if (d === 0) { e = i; break; } }
  }
  if (e < 0) e = t.lastIndexOf('}');
  if (e <= s) return {};
  t = t.slice(s, e + 1);
  try { return JSON.parse(t); } catch {
    try { return JSON.parse(t.replace(/(\{|\,)\s*(\w+)\s*\:/g, '$1"$2":')); } catch { return {}; }
  }
}

function smartMerge(target: Record<string, unknown>, source: Record<string, unknown>) {
  for (const [k, v] of Object.entries(source)) {
    const exist = target[k];
    const vEmpty = v === null || v === '' || v === undefined || (Array.isArray(v) && v.length === 0);
    const eEmpty = exist === null || exist === '' || exist === undefined || (Array.isArray(exist) && exist.length === 0);
    if (exist === undefined || (eEmpty && !vEmpty)) {
      target[k] = v;
    } else if (!vEmpty && Array.isArray(v) && Array.isArray(exist)) {
      target[k] = [...exist, ...v];
    }
  }
}

// ── 10 Focused Research Queries ──

const QUERIES: { module: string; prompt: (company: string) => string }[] = [
  {
    module: '公司概览',
    prompt: (c) => `关于"${c}"，提供：
{"companyName":"全称","businessDescription":"一句话业务描述(100字)","founded":"成立年份","headquarters":"总部城市","businessModel":"商业模式(SaaS/电商/硬件/服务/平台/制造等)","website":"官网URL","employeeCount":"员工数(如500或1000-1500)","milestones":["里程碑1","里程碑2","里程碑3"]}`,
  },
  {
    module: '团队与治理',
    prompt: (c) => `关于"${c}"的团队信息：
{"founders":[{"name":"姓名","role":"职位","background":"详细背景(学历/前公司/成就)","ownership":"持股%"}],"keyExecutives":[{"name":"姓名","role":"职位","background":"背景"}]}`,
  },
  {
    module: '行业与市场',
    prompt: (c) => `关于"${c}"的行业和市场信息：
{"industry":"所属行业","subIndustry":"细分赛道","tam":"TAM市场规模(万元人民币,纯数字)","sam":"SAM(万元)","som":"SOM(万元)","marketGrowth":"市场年增速(百分比数字如25)","chainUp":"上游(供应商/原材料)","chainMid":"公司在产业链位置","chainDown":"下游(客户/渠道)","keyTrends":"行业趋势(100字)","entryBarriers":"进入壁垒(技术/资金/牌照/网络效应)","regulation":"监管环境(政策影响/合规要求)"}`,
  },
  {
    module: '竞品与竞争',
    prompt: (c) => `关于"${c}"的竞争对手：
{"competitors":[{"name":"竞品名","stage":"阶段(种子/天使/A/B/C/上市)","scale":"规模(万元)","funding":"融资额(万元)","advantage":"核心优势"}],"competitiveAdvantage":"${c}的核心竞争壁垒(技术/品牌/网络效应/规模/牌照等)"}`,
  },
  {
    module: '产品与技术',
    prompt: (c) => `关于"${c}"的产品和技术：
{"mainProducts":[{"name":"产品名","stage":"研发/内测/已发布/规模化","revenuePct":"收入占比%(如60)","description":"简介"}],"ipPatents":"知识产权/专利(数量+核心技术描述)","rdPipeline":"研发管线(在研项目/技术路线)"}`,
  },
  {
    module: '财务分析',
    prompt: (c) => `关于"${c}"的财务数据(万元人民币,纯数字,不知道填null)：
{"revenue":"最新年度营收","revenue2023":"2023营收","revenue2024":"2024营收","revenue2025":"2025营收","grossProfit":"毛利","grossProfit2023":"2023毛利","grossProfit2024":"2024毛利","grossProfit2025":"2025毛利","netIncome":"净利润","netIncome2023":"2023净利","netIncome2024":"2024净利","netIncome2025":"2025净利","ebitda":"EBITDA","grossMargin":"毛利率%(纯数字如60)","netMargin":"净利率%(纯数字)","operatingCashFlow":"经营现金流","freeCashFlow":"自由现金流","cashBalance":"现金余额","burnRate":"月消耗","customerCount":"客户数","arpu":"ARPU(元)","cac":"获客成本(元)","ltv":"客户终身价值(元)","arr":"ARR(万元,SaaS公司)","nrr":"NRR净收入留存率%(如110)"}`,
  },
  {
    module: '估值与退出',
    prompt: (c) => `关于"${c}"的估值信息(万元人民币,纯数字,不知道填null)：
{"valuation":"最新估值","totalFunding":"累计融资总额","valFcf":"FCF自由现金流基准","valWacc":"WACC(如0.10)","valGrowth":"永续增长率(如0.03)","targetIrr":"目标IRR%(如25)","entryValuation":"进入估值","esopPct":"ESOP占比%(如10)","exitValue":"预期退出估值","ownershipPct":"预期持股%(如15)","holdingYears":"预期持有年数(如5)"}`,
  },
  {
    module: '融资历史',
    prompt: (c) => `关于"${c}"的融资历史：
{"financingRounds":[{"name":"轮次(天使/Pre-A/A/B/C/D/战略)","date":"日期(如2023-06)","amount":"金额(万元,纯数字)","preMoneyVal":"投前估值(万元)","postMoneyVal":"投后估值(万元)","investors":"投资方(逗号分隔)"}],"keyInvestors":["投资方1","投资方2"]}`,
  },
  {
    module: '销售与供应链',
    prompt: (c) => `关于"${c}"的客户、供应商、合同信息(不知道填null/空数组)：
{"sales":[{"customerName":"大客户名","businessLine":"业务线","revenue2024":"2024贡献收入(万元)","revenue2025":"2025贡献收入(万元)","grossMargin":"毛利率%"}],"procurement":[{"supplierName":"供应商名","category":"类别(芯片/云服务/原材料/物流等)","amount2024":"2024采购额(万元)","amount2025":"2025采购额(万元)"}],"contracts":[{"name":"合同名","party":"对方","amount":"金额(万元)","startDate":"开始","endDate":"结束","content":"简述"}]}`,
  },
  {
    module: '风险与合规',
    prompt: (c) => `关于"${c}"的风险因素(不知道填null/空数组)：
{"riskFactors":["风险1(如客户集中度风险)","风险2(如政策监管风险)","风险3(如技术迭代风险)","风险4(如人才流失风险)","风险5(如现金流风险)"],"legalIssues":"已知的法律/合规问题或纠纷(没有填null)"}`,
  },
];

// ── Main Profiling ──

export async function profileCompany(companyName: string): Promise<ProfileResult> {
  const merged: Record<string, unknown> = {};
  const moduleCoverage: { module: string; fields: number }[] = [];

  // Run all 10 queries in parallel batches of 4 (to avoid rate limits)
  const batchSize = 4;
  for (let i = 0; i < QUERIES.length; i += batchSize) {
    const batch = QUERIES.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(q => callAI(q.prompt(companyName)).then(r => ({ module: q.module, data: parseJson(r) })))
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        const fieldsBefore = Object.keys(merged).length;
        smartMerge(merged, r.value.data);
        const newFields = Object.keys(merged).length - fieldsBefore;
        if (newFields > 0) {
          moduleCoverage.push({ module: r.value.module, fields: newFields });
        }
      }
    }
  }

  if (Object.keys(merged).length === 0) {
    return { profile: null, confidence: 'low', filledFields: [], moduleCoverage: [], error: 'AI 未返回有效信息。该公司的公开数据可能较少。' };
  }

  // Build profile
  const p: CompanyProfile = {
    companyName: String(merged.companyName || companyName),
    businessDescription: String(merged.businessDescription || ''),
    founded: String(merged.founded || ''),
    headquarters: String(merged.headquarters || ''),
    businessModel: String(merged.businessModel || ''),
    website: String(merged.website || ''),
    employeeCount: String(merged.employeeCount || ''),
    milestones: Array.isArray(merged.milestones) ? merged.milestones : [],
    founders: Array.isArray(merged.founders) ? merged.founders : [],
    keyExecutives: Array.isArray(merged.keyExecutives) ? merged.keyExecutives : [],
    industry: String(merged.industry || ''),
    subIndustry: String(merged.subIndustry || ''),
    tam: String(merged.tam || ''),
    sam: String(merged.sam || ''),
    som: String(merged.som || ''),
    marketGrowth: String(merged.marketGrowth || ''),
    chainUp: String(merged.chainUp || ''),
    chainMid: String(merged.chainMid || ''),
    chainDown: String(merged.chainDown || ''),
    keyTrends: String(merged.keyTrends || ''),
    entryBarriers: String(merged.entryBarriers || ''),
    regulation: String(merged.regulation || ''),
    competitors: Array.isArray(merged.competitors) ? merged.competitors : [],
    competitiveAdvantage: String(merged.competitiveAdvantage || ''),
    mainProducts: Array.isArray(merged.mainProducts) ? merged.mainProducts : [],
    ipPatents: String(merged.ipPatents || ''),
    rdPipeline: String(merged.rdPipeline || ''),
    revenue: String(merged.revenue || ''),
    revenue2023: String(merged.revenue2023 || ''),
    revenue2024: String(merged.revenue2024 || ''),
    revenue2025: String(merged.revenue2025 || ''),
    grossProfit: String(merged.grossProfit || ''),
    grossProfit2023: String(merged.grossProfit2023 || ''),
    grossProfit2024: String(merged.grossProfit2024 || ''),
    grossProfit2025: String(merged.grossProfit2025 || ''),
    netIncome: String(merged.netIncome || ''),
    netIncome2023: String(merged.netIncome2023 || ''),
    netIncome2024: String(merged.netIncome2024 || ''),
    netIncome2025: String(merged.netIncome2025 || ''),
    ebitda: String(merged.ebitda || ''),
    grossMargin: String(merged.grossMargin || ''),
    netMargin: String(merged.netMargin || ''),
    operatingCashFlow: String(merged.operatingCashFlow || ''),
    freeCashFlow: String(merged.freeCashFlow || ''),
    cashBalance: String(merged.cashBalance || ''),
    burnRate: String(merged.burnRate || ''),
    customerCount: String(merged.customerCount || ''),
    arpu: String(merged.arpu || ''),
    cac: String(merged.cac || ''),
    ltv: String(merged.ltv || ''),
    arr: String(merged.arr || ''),
    nrr: String(merged.nrr || ''),
    valuation: String(merged.valuation || ''),
    totalFunding: String(merged.totalFunding || ''),
    valFcf: String(merged.valFcf || ''),
    valWacc: String(merged.valWacc || ''),
    valGrowth: String(merged.valGrowth || ''),
    targetIrr: String(merged.targetIrr || ''),
    entryValuation: String(merged.entryValuation || ''),
    esopPct: String(merged.esopPct || ''),
    exitValue: String(merged.exitValue || ''),
    ownershipPct: String(merged.ownershipPct || ''),
    holdingYears: String(merged.holdingYears || ''),
    latestRound: String(merged.latestRound || ''),
    latestRoundAmount: String(merged.latestRoundAmount || ''),
    latestRoundDate: String(merged.latestRoundDate || ''),
    keyInvestors: Array.isArray(merged.keyInvestors) ? merged.keyInvestors : [],
    financingRounds: Array.isArray(merged.financingRounds) ? merged.financingRounds : [],
    sales: Array.isArray(merged.sales) ? merged.sales : [],
    procurement: Array.isArray(merged.procurement) ? merged.procurement : [],
    contracts: Array.isArray(merged.contracts) ? merged.contracts : [],
    riskFactors: Array.isArray(merged.riskFactors) ? merged.riskFactors : [],
    legalIssues: String(merged.legalIssues || ''),
  };

  const filled = countFilled(p);
  const confidence: ProfileResult['confidence'] =
    filled.length >= 30 ? 'high' : filled.length >= 15 ? 'medium' : 'low';

  return { profile: p, confidence, filledFields: filled, moduleCoverage };
}

function countFilled(p: CompanyProfile): string[] {
  const filled: string[] = [];
  const checks: [string, unknown][] = [
    ['companyName', p.companyName], ['businessDescription', p.businessDescription],
    ['founded', p.founded], ['headquarters', p.headquarters],
    ['businessModel', p.businessModel], ['website', p.website],
    ['employeeCount', p.employeeCount], ['industry', p.industry],
    ['subIndustry', p.subIndustry], ['tam', p.tam], ['sam', p.sam], ['som', p.som],
    ['marketGrowth', p.marketGrowth], ['chainUp', p.chainUp], ['chainMid', p.chainMid],
    ['chainDown', p.chainDown], ['keyTrends', p.keyTrends], ['entryBarriers', p.entryBarriers],
    ['regulation', p.regulation], ['competitiveAdvantage', p.competitiveAdvantage],
    ['ipPatents', p.ipPatents], ['rdPipeline', p.rdPipeline],
    ['revenue', p.revenue], ['revenue2023', p.revenue2023], ['revenue2024', p.revenue2024],
    ['revenue2025', p.revenue2025], ['grossProfit', p.grossProfit],
    ['netIncome', p.netIncome], ['ebitda', p.ebitda], ['grossMargin', p.grossMargin],
    ['netMargin', p.netMargin], ['operatingCashFlow', p.operatingCashFlow],
    ['freeCashFlow', p.freeCashFlow], ['cashBalance', p.cashBalance],
    ['burnRate', p.burnRate], ['customerCount', p.customerCount],
    ['arpu', p.arpu], ['cac', p.cac], ['ltv', p.ltv], ['arr', p.arr], ['nrr', p.nrr],
    ['valuation', p.valuation], ['totalFunding', p.totalFunding],
    ['valFcf', p.valFcf], ['valWacc', p.valWacc], ['targetIrr', p.targetIrr],
    ['entryValuation', p.entryValuation], ['esopPct', p.esopPct],
    ['exitValue', p.exitValue], ['ownershipPct', p.ownershipPct],
    ['holdingYears', p.holdingYears], ['latestRound', p.latestRound],
    ['legalIssues', p.legalIssues],
  ];
  for (const [name, value] of checks) {
    if (value && value !== '' && value !== 'null' && value !== 'undefined') {
      if (Array.isArray(value) && value.length === 0) continue;
      filled.push(name);
    }
  }
  if (p.milestones.length > 0) filled.push('milestones');
  if (p.founders.length > 0) filled.push('founders');
  if (p.keyExecutives.length > 0) filled.push('keyExecutives');
  if (p.competitors.length > 0) filled.push('competitors');
  if (p.mainProducts.length > 0) filled.push('mainProducts');
  if (p.financingRounds.length > 0) filled.push('financingRounds');
  if (p.sales.length > 0) filled.push('sales');
  if (p.procurement.length > 0) filled.push('procurement');
  if (p.contracts.length > 0) filled.push('contracts');
  if (p.riskFactors.length > 0) filled.push('riskFactors');
  if (p.keyInvestors.length > 0) filled.push('keyInvestors');
  return filled;
}
