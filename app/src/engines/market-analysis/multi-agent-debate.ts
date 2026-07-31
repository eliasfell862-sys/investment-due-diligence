/**
 * Multi-Agent Investment Debate Engine
 *
 * Inspired by TradingAgents-CN architecture.
 * 5 independent AI agents debate: 多头(bull), 空头(bear), 风险(risk),
 * 估值(valuation), 策略(strategy). Results synthesized into consensus report.
 */

import { loadResearchConfig, PROVIDER_PRESETS } from '../../infrastructure/research/research-adapter';

// ── Types ──

export interface AgentReport {
  agent: string;
  role: string;
  icon: string;
  thesis: string;          // 核心观点
  keyPoints: string[];     // 关键论据
  confidence: 'high' | 'medium' | 'low';
}

export interface DebateRound {
  round: number;
  label: string;
  reports: AgentReport[];
}

export interface DebateResult {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  depth: DebateDepth;
  rounds: DebateRound[];
  reports: AgentReport[];  // Latest round (backward compat)
  roundHistory: AgentReport[][]; // All rounds
  consensus: string;
  riskLevel: '低' | '中' | '高' | '极高';
  actionBias: '强烈看多' | '偏多' | '中性' | '偏空' | '强烈看空';
  keyCatalysts: string[];
  keyRisks: string[];
  priceTarget: { low: string; mid: string; high: string };
  generatedAt: string;
}

export type DebateDepth = 'quick' | 'standard' | 'deep';

// ── Agent Definitions ──

interface AgentDef {
  id: string;
  role: string;
  icon: string;
  systemPrompt: string;
  userPromptTemplate: (symbol: string, name: string, price: number, changePct: number) => string;
}

const AGENTS: AgentDef[] = [
  {
    id: 'bull', role: '多头分析师', icon: '🐂',
    systemPrompt: '你是资深多头策略分析师。从成长性、竞争优势、行业趋势、盈利改善等角度，积极发掘投资机会和正面因素。论点要有数据支撑。输出格式：先一句话核心观点，然后列出3-5个关键正面论据。',
    userPromptTemplate: (s, n, p, _c) =>
      `请从多头角度分析 ${n}(${s})，当前价格${p}，涨跌${_c >= 0 ? '+' : ''}${_c.toFixed(2)}%。\n\n请提供：\n1. 一句话核心多头观点\n2. 3-5个关键看多理由（结合行业、竞争力、成长性、估值等维度）\n3. 如果这只股票值得买入，最重要的1-2个催化剂是什么`,
  },
  {
    id: 'bear', role: '空头分析师', icon: '🐻',
    systemPrompt: '你是严谨的空头策略分析师。从估值泡沫、竞争威胁、行业下行、财务风险、管理层问题、宏观不利因素等角度，系统性揭示风险。论点要有逻辑和数据支撑。',
    userPromptTemplate: (s, n, p, _c) =>
      `请从空头角度质疑 ${n}(${s})，当前价格${p}，涨跌${_c >= 0 ? '+' : ''}${_c.toFixed(2)}%。\n\n请提供：\n1. 一句话核心空头观点\n2. 3-5个关键看空理由（从估值、竞争、行业周期、财务健康等角度）\n3. 最大的1-2个"黑天鹅"风险是什么`,
  },
  {
    id: 'risk', role: '风控分析师', icon: '🛡️',
    systemPrompt: '你是专业风控分析师。从波动率、最大回撤、流动性、仓位集中度、杠杆水平、政策监管、汇率风险等角度，独立评估风险状况。给出风险等级（低/中/高/极高）和量化的风险评估。',
    userPromptTemplate: (s, n, p, _c) =>
      `请评估 ${n}(${s}) 的风险状况，当前价格${p}。\n\n请提供：\n1. 风险等级判断（低/中/高/极高）\n2. 3-5个主要风险因素及影响程度\n3. 建议的风控措施（如止损位、仓位上限等）`,
  },
  {
    id: 'valuation', role: '估值分析师', icon: '📊',
    systemPrompt: '你是估值分析专家。从PE/PB/PS/EV/EBITDA、DCF、可比公司等角度评估当前估值水平。判断是否合理、低估还是高估，给出目标价区间。',
    userPromptTemplate: (s, n, p, _c) =>
      `请评估 ${n}(${s}) 的估值水平，当前价格${p}。\n\n请提供：\n1. 当前估值水平判断（合理/低估/高估）及依据\n2. 基于估值模型的目标价区间（低/中/高）\n3. 估值的主要假设和敏感性因素`,
  },
  {
    id: 'strategy', role: '策略分析师', icon: '🎯',
    systemPrompt: '你是交易策略专家。综合多空双方观点和风险评估，给出具体的操作建议。包括：入场时机、仓位建议、持仓周期、止盈止损位、以及不同情景下的应对方案。',
    userPromptTemplate: (s, n, p, _c) =>
      `请综合多空因素，为 ${n}(${s}) 给出操作策略建议，当前价格${p}。\n\n请提供：\n1. 综合判断（强烈看多/偏多/中性/偏空/强烈看空）\n2. 建议操作（买入/持有/减仓/卖出/观望）及仓位\n3. 建议的止损位和止盈目标\n4. 持仓周期建议（短线/中线/长线）`,
  },
];

// ── AI Call ──

async function callAI(systemPrompt: string, userPrompt: string): Promise<string> {
  const cfg = loadResearchConfig();
  if (!cfg) throw new Error('请先配置 AI 模型');

  const preset = PROVIDER_PRESETS[cfg.provider] ?? PROVIDER_PRESETS.custom;
  const endpoint = cfg.endpoint || preset.endpoint;
  const model = cfg.model || (cfg.provider === 'ollama' ? 'deepseek-r1:14b' : 'deepseek-chat');
  const maxTokens = cfg.provider === 'ollama' ? 4096 : 8192;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

  const resp = await fetch(endpoint, {
    method: 'POST', headers,
    body: JSON.stringify({
      model, messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ], max_tokens: maxTokens, temperature: 0.3,
    }),
  });
  if (!resp.ok) throw new Error(`API ${resp.status}`);
  const data = await resp.json() as any;
  return data.choices?.[0]?.message?.content || '';
}

// ── Parse Agent Response ──

function parseAgentResponse(text: string, agent: AgentDef): AgentReport {
  const lines = text.split('\n').filter(l => l.trim());
  const thesis = lines[0]?.replace(/^[#*\d.\s]+/, '').trim() || text.slice(0, 100);
  const keyPoints = lines.slice(1, 6)
    .filter(l => l.trim().length > 5)
    .map(l => l.replace(/^[#*\d.\-\s]+/, '').trim());

  return {
    agent: agent.id,
    role: agent.role,
    icon: agent.icon,
    thesis: thesis.length > 200 ? thesis.slice(0, 200) + '...' : thesis,
    keyPoints: keyPoints.length > 0 ? keyPoints : [thesis],
    confidence: keyPoints.length >= 4 ? 'high' : keyPoints.length >= 2 ? 'medium' : 'low',
  };
}

// ── Synthesize Consensus ──

function synthesize(reports: AgentReport[], symbol: string, name: string): Pick<DebateResult, 'consensus' | 'riskLevel' | 'actionBias' | 'keyCatalysts' | 'keyRisks' | 'priceTarget'> {
  const bull = reports.find(r => r.agent === 'bull');
  const bear = reports.find(r => r.agent === 'bear');
  const risk = reports.find(r => r.agent === 'risk');

  // Risk level from risk agent
  let riskLevel: DebateResult['riskLevel'] = '中';
  if (risk) {
    const riskText = risk.thesis + risk.keyPoints.join(' ');
    if (riskText.includes('极高') || riskText.includes('严重')) riskLevel = '极高';
    else if (riskText.includes('高') && !riskText.includes('不高')) riskLevel = '高';
    else if (riskText.includes('低') && !riskText.includes('不低')) riskLevel = '低';
  }

  // Action bias: count positive vs negative points
  const bullPoints = bull?.keyPoints.length || 0;
  const bearPoints = bear?.keyPoints.length || 0;
  let actionBias: DebateResult['actionBias'] = '中性';
  if (bullPoints >= 4 && bearPoints <= 2) actionBias = '强烈看多';
  else if (bullPoints > bearPoints) actionBias = '偏多';
  else if (bearPoints >= 4 && bullPoints <= 2) actionBias = '强烈看空';
  else if (bearPoints > bullPoints) actionBias = '偏空';

  // Key catalysts and risks
  const keyCatalysts = bull?.keyPoints?.slice(0, 3) || [];
  const keyRisks = bear?.keyPoints?.slice(0, 3) || [];

  // Consensus
  const consensus = `${name}(${symbol})：多头提出${bullPoints}个正面因素，空头提出${bearPoints}个风险点。综合评估：${actionBias}，风险等级${riskLevel}。${bullPoints > bearPoints ? '看多逻辑略占优' : bearPoints > bullPoints ? '需警惕下行风险' : '多空力量均衡，建议观望'}。`;

  return {
    consensus, riskLevel, actionBias, keyCatalysts, keyRisks,
    priceTarget: { low: '—', mid: '—', high: '—' },
  };
}

// ── Main ──

// ── Round 2: Rebuttal prompts ──

function rebuttalPrompt(agent: AgentDef, opponent: AgentDef, opponentReport: AgentReport, symbol: string, name: string, price: number): string {
  if (agent.id === 'bull') {
    return `${opponent.role} 认为：「${opponentReport.thesis}」\n其关键论据：\n${opponentReport.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\n请逐条反驳上述空头观点，用事实和逻辑证明为什么这些担忧被过度放大了。控制在200字以内。`;
  }
  if (agent.id === 'bear') {
    return `${opponent.role} 认为：「${opponentReport.thesis}」\n其关键论据：\n${opponentReport.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\n请逐条反驳上述多头观点，揭示其中的乐观假设和潜在风险。控制在200字以内。`;
  }
  return '';
}

function finalSynthesisPrompt(bullRound2: AgentReport, bearRound2: AgentReport, risk: AgentReport, symbol: string, name: string, price: number): string {
  return `多头第二轮反驳：「${bullRound2.thesis}」\n空头第二轮反驳：「${bearRound2.thesis}」\n风控评估：「${risk.thesis}」\n\n请综合以上所有辩论结果，给出最终的投资策略建议。包括：\n1. 综合判断（强烈看多/偏多/中性/偏空/强烈看空）\n2. 建议仓位和操作\n3. 关键风险提示\n控制在300字以内。`;
}

// ── Main ──

export async function runMultiAgentDebate(
  symbol: string, name: string, price: number, changePct: number,
  depth: DebateDepth = 'quick',
): Promise<DebateResult> {
  const roundHistory: AgentReport[][] = [];
  const rounds: DebateRound[] = [];

  // ── Round 1: All 5 agents give initial opinions ──
  const r1Results = await Promise.allSettled(
    AGENTS.map(async (agent) => {
      const prompt = agent.userPromptTemplate(symbol, name, price, changePct);
      const response = await callAI(agent.systemPrompt, prompt);
      return parseAgentResponse(response, agent);
    }),
  );

  const round1Reports = r1Results.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<AgentReport>).value);
  roundHistory.push(round1Reports);
  rounds.push({ round: 1, label: '首轮分析', reports: round1Reports });

  if (round1Reports.length === 0) {
    const fallback: AgentReport = { agent: 'system', role: '系统', icon: '🤖', thesis: 'AI 分析服务暂不可用', keyPoints: ['请检查 AI 模型配置'], confidence: 'low' };
    roundHistory[0] = [fallback];
    rounds[0] = { round: 1, label: '首轮分析', reports: [fallback] };
    return buildResult(symbol, name, price, changePct, depth, roundHistory, rounds);
  }

  // ── Round 2: Bull ↔ Bear rebuttal (standard + deep) ──
  let round2Reports: AgentReport[] = [];

  if (depth === 'standard' || depth === 'deep') {
    const bull = AGENTS.find(a => a.id === 'bull')!;
    const bear = AGENTS.find(a => a.id === 'bear')!;
    const bullR1 = round1Reports.find(r => r.agent === 'bull');
    const bearR1 = round1Reports.find(r => r.agent === 'bear');

    if (bullR1 && bearR1) {
      const r2Results = await Promise.allSettled([
        callAI(bull.systemPrompt, rebuttalPrompt(bull, bear, bearR1, symbol, name, price))
          .then(r => parseAgentResponse(r, { ...bull, id: 'bull_r2', role: '多头反驳' })),
        callAI(bear.systemPrompt, rebuttalPrompt(bear, bull, bullR1, symbol, name, price))
          .then(r => parseAgentResponse(r, { ...bear, id: 'bear_r2', role: '空头反驳' })),
      ]);

      round2Reports = r2Results.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<AgentReport>).value);
      if (round2Reports.length > 0) {
        roundHistory.push(round2Reports);
        rounds.push({ round: 2, label: '多空交锋', reports: round2Reports });
      }
    }
  }

  // ── Round 3: Strategy agent synthesizes final verdict (deep only) ──
  if (depth === 'deep') {
    const strategy = AGENTS.find(a => a.id === 'strategy')!;
    const bullR2 = round2Reports.find(r => r.agent === 'bull_r2') || round1Reports.find(r => r.agent === 'bull');
    const bearR2 = round2Reports.find(r => r.agent === 'bear_r2') || round1Reports.find(r => r.agent === 'bear');
    const risk = round1Reports.find(r => r.agent === 'risk');

    if (bullR2 && bearR2 && risk) {
      try {
        const synthesisText = await callAI(strategy.systemPrompt, finalSynthesisPrompt(bullR2, bearR2, risk, symbol, name, price));
        const synthesisReport = parseAgentResponse(synthesisText, { ...strategy, id: 'strategy_final', role: '最终策略' });
        roundHistory.push([synthesisReport]);
        rounds.push({ round: 3, label: '最终综合', reports: [synthesisReport] });
      } catch { /* Round 3 is optional */ }
    }
  }

  return buildResult(symbol, name, price, changePct, depth, roundHistory, rounds);
}

function buildResult(
  symbol: string, name: string, price: number, changePct: number,
  depth: DebateDepth,
  roundHistory: AgentReport[][],
  rounds: DebateRound[],
): DebateResult {
  const latestRound = roundHistory[roundHistory.length - 1] || [];
  const {
    consensus, riskLevel, actionBias, keyCatalysts, keyRisks, priceTarget,
  } = synthesize(roundHistory.flat(), symbol, name);

  return {
    symbol, name, price, changePct, depth,
    rounds,
    reports: latestRound,
    roundHistory,
    consensus, riskLevel, actionBias,
    keyCatalysts, keyRisks, priceTarget,
    generatedAt: new Date().toISOString(),
  };
}
