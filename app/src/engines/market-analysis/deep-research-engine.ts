/**
 * Deep Research Engine — TypeScript port of TradingAgents-CN 5-Analyst System.
 *
 * Architecture (mirrors TradingAgents):
 *   Phase 1: 5 Independent Analysts research in parallel
 *   Phase 2: Bull + Bear Researchers synthesize
 *   Phase 3: Risk Manager evaluates
 *   Phase 4: Final Report with rating + price targets
 *
 * Original: tradingagents/agents/analysts/*.py
 */

import { executeAiTask } from '../../features/ai-agents/ai-gateway';
import { getAiGatewayRuntime } from '../../features/ai-agents/ai-gateway-runtime';
import type { StockQuote, DailyBasicData } from '../../infrastructure/market-data/stock-api';
import type { CapitalFlow } from '../../infrastructure/market-data/capital-flow-api';
import type { FundamentalScore } from './fundamental-scorer';
import type { StrategySignal } from './trading-strategies';
import type { BacktestResult } from './backtest-engine';

export interface ResearchReport {
  /** Overall rating */
  rating: '强烈买入' | '买入' | '持有' | '减持' | '卖出';
  ratingScore: number; // 0-100

  /** Phase 1: Individual analyst reports */
  technicalAnalysis: string;
  fundamentalAnalysis: string;
  sentimentAnalysis: string;
  chinaMarketAnalysis: string;

  /** Phase 2: Bull vs Bear */
  bullCase: string;
  bearCase: string;

  /** Phase 3: Risk assessment */
  riskAssessment: string;
  riskLevel: '低' | '中' | '高' | '极高';

  /** Phase 4: Final */
  priceTarget: { low: number; mid: number; high: number };
  stopLoss: number;
  holdingPeriod: string;
  confidenceLevel: string;
  keyCatalysts: string[];
  keyRisks: string[];
  summary: string;

  /** Metadata */
  generatedAt: string;
  dataSources: string[];
}

interface ResearchContext {
  stock: StockQuote;
  klines: any[];
  financial: DailyBasicData | null;
  fundamentals: FundamentalScore;
  strategies: StrategySignal[];
  fundFlow: CapitalFlow | null;
  backtest: BacktestResult | null;
}

// ── LLM call helper ──
// 传输走统一 AI Gateway + 本机加密密钥库运行时注册表。
async function callLLM(
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const response = await executeAiTask({
    taskId: 'securities.stock_analysis',
    systemPrompt,
    userPrompt,
    responseFormat: 'text',
  }, getAiGatewayRuntime());
  return response.content;
}

// ── Build context string ──
function buildDataContext(ctx: ResearchContext): string {
  const { stock, klines, financial, fundamentals, strategies, fundFlow, backtest } = ctx;
  const last = klines[klines.length - 1] as any;
  const prev = klines[klines.length - 2] as any;

  const parts: string[] = [];

  // Basic info
  parts.push(`【股票信息】`);
  parts.push(`${stock.name}(${stock.code}) | 最新价: ${stock.price.toFixed(2)} | 涨跌: ${stock.changePct >= 0 ? '+' : ''}${stock.changePct.toFixed(2)}%`);
  parts.push(`今开: ${stock.open > 0 ? stock.open.toFixed(2) : '—'} | 昨收: ${stock.preClose > 0 ? stock.preClose.toFixed(2) : '—'} | 最高: ${stock.high > 0 ? stock.high.toFixed(2) : '—'} | 最低: ${stock.low > 0 ? stock.low.toFixed(2) : '—'}`);
  parts.push(`PE: ${stock.pe > 0 ? stock.pe.toFixed(1) : '—'} | PB: ${stock.pb > 0 ? stock.pb.toFixed(2) : '—'} | 市值: ${stock.totalCap > 0 ? stock.totalCap.toFixed(0) + '亿' : '—'}`);
  parts.push(`成交量: ${stock.volume > 0 ? (stock.volume / 10000).toFixed(1) + '万手' : '—'} | 换手率: ${stock.turnover > 0 ? stock.turnover.toFixed(2) + '%' : '—'}`);

  // Technical indicators
  if (last?.macd) {
    parts.push('');
    parts.push(`【技术指标】`);
    parts.push(`MACD: DIF=${last.macd.dif?.toFixed(3)} DEA=${last.macd.dea?.toFixed(3)} 柱=${last.macd.bar?.toFixed(3)} | ${last.macd.dif > last.macd.dea ? '多头排列' : '空头排列'}${prev?.macd && prev.macd.dif <= prev.macd.dea && last.macd.dif > last.macd.dea ? ' ⚠️刚金叉' : ''}`);
    if (last?.kdj) parts.push(`KDJ: K=${last.kdj.k?.toFixed(1)} D=${last.kdj.d?.toFixed(1)} J=${last.kdj.j?.toFixed(1)} | ${last.kdj.j > 80 ? '超买区' : last.kdj.j < 20 ? '超卖区' : '正常'}`);
    if (last?.rsi) parts.push(`RSI: 6日=${last.rsi.rsi6?.toFixed(1)} 12日=${last.rsi.rsi12?.toFixed(1)} 24日=${last.rsi.rsi24?.toFixed(1)}`);
    if (last?.ma) parts.push(`均线: MA5=${last.ma.ma5?.toFixed(2)} MA20=${last.ma.ma20?.toFixed(2)} MA60=${last.ma.ma60?.toFixed(2) || '—'} | ${last.close > last.ma.ma20 ? '价格>MA20偏多' : '价格<MA20偏空'}`);
    if (last?.boll) {
      const bollPos = ((last.close - last.boll.lower) / (last.boll.upper - last.boll.lower) * 100).toFixed(0);
      parts.push(`BOLL: 上=${last.boll.upper?.toFixed(2)} 中=${last.boll.mid?.toFixed(2)} 下=${last.boll.lower?.toFixed(2)} | 价格处在${bollPos}%位置`);
    }
  }

  // Fundamentals
  parts.push('');
  parts.push(`【基本面评分】${fundamentals.rating}(${fundamentals.totalScore}分)`);
  fundamentals.breakdown.forEach(b => parts.push(`- ${b.category}: ${b.score}/${b.max} — ${b.detail}`));
  if (financial) {
    if (financial.roe > 0) parts.push(`ROE: ${financial.roe.toFixed(1)}%`);
    if (financial.roa > 0) parts.push(`ROA: ${financial.roa.toFixed(1)}%`);
    if (financial.grossMargin > 0) parts.push(`毛利率: ${financial.grossMargin.toFixed(1)}%`);
    if (financial.revenueGrowth !== 0) parts.push(`营收增速: ${financial.revenueGrowth.toFixed(1)}%`);
    if (financial.profitGrowth !== 0) parts.push(`利润增速: ${financial.profitGrowth.toFixed(1)}%`);
    if (financial.debtRatio > 0) parts.push(`负债率: ${financial.debtRatio.toFixed(1)}%`);
  }

  // Strategies
  if (strategies.length > 0) {
    parts.push('');
    parts.push(`【策略信号】触发${strategies.length}个：`);
    strategies.forEach(s => parts.push(`- ${s.type === 'buy' ? '📈' : '📉'} ${s.name}[${s.strength}]: ${s.description}`));
  }

  // Capital flow
  if (fundFlow) {
    parts.push('');
    parts.push(`【资金流向】`);
    parts.push(`主力净流入: ${(fundFlow.mainNet / 10000).toFixed(2)}亿 (占比${fundFlow.mainRatio.toFixed(1)}%)`);
    parts.push(`超大单: ${(fundFlow.superLargeNet / 10000).toFixed(2)}亿 | 大单: ${(fundFlow.largeNet / 10000).toFixed(2)}亿`);
  }

  // Backtest
  if (backtest) {
    parts.push('');
    parts.push(`【策略回测】${backtest.period}`);
    parts.push(`胜率: ${backtest.winRate}% | 年化: ${backtest.annualReturn}% | 最大回撤: -${backtest.maxDrawdown}% | 夏普: ${backtest.sharpeRatio}`);
  }

  // Recent price action
  const recent20 = klines.slice(-20);
  if (recent20.length >= 20) {
    const high20 = Math.max(...recent20.map((k: any) => k.high));
    const low20 = Math.min(...recent20.map((k: any) => k.low));
    const avgVol20 = recent20.reduce((s: number, k: any) => s + k.volume, 0) / 20;
    parts.push('');
    parts.push(`【近期统计】20日最高: ${high20.toFixed(2)} | 最低: ${low20.toFixed(2)} | 振幅: ${((high20 - low20) / low20 * 100).toFixed(1)}%`);
    parts.push(`20日均量: ${(avgVol20 / 10000).toFixed(0)}万手 | 今日${last?.volume > avgVol20 * 1.5 ? '放量' : last?.volume < avgVol20 * 0.5 ? '缩量' : '正常'}`);
  }

  return parts.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// Phase 1: 5 Analysts (run in parallel)
// ═══════════════════════════════════════════════════════════════

async function technicalAnalyst(dataCtx: string): Promise<string> {
  const system = `你是资深A股技术分析师。基于提供的真实行情数据和技术指标，进行专业的技术面分析。
输出格式：
## 📊 技术面分析
### 趋势判断
[分析当前趋势：上升/下降/横盘，说明理由]
### 指标解读
[MACD/KDJ/RSI/BOLL/MA 各指标状态和含义]
### 量价关系
[成交量和价格配合情况]
### 关键价位
[支撑位和压力位]
### 技术面结论
[偏多/偏空/中性，给出操作建议]`;

  return callLLM(system, dataCtx);
}

async function fundamentalAnalyst(dataCtx: string): Promise<string> {
  const system = `你是资深A股基本面分析师。基于提供的财务数据和估值指标，进行专业的基本面分析。
输出格式：
## 💰 基本面分析
### 盈利能力
[ROE/ROA/毛利率分析]
### 成长性
[营收增速/利润增速分析]
### 估值水平
[PE/PB/股息率分析，是否低估/高估]
### 财务健康
[负债率/流动比率分析]
### 基本面结论
[偏多/偏空/中性，给出估值判断]`;

  return callLLM(system, dataCtx);
}

async function sentimentAnalyst(dataCtx: string): Promise<string> {
  const system = `你是资深A股市场情绪分析师。基于资金流向、成交量、换手率、策略信号等数据，分析市场情绪。
输出格式：
## 📰 市场情绪分析
### 资金面
[主力资金/北向资金流向分析]
### 交易热度
[换手率/成交量/振幅分析]
### 信号共振
[多个技术信号是否一致]
### 情绪判断
[贪婪/恐惧/中性]
### 情绪面结论`;

  return callLLM(system, dataCtx);
}

async function chinaMarketAnalyst(dataCtx: string): Promise<string> {
  const system = `你是资深A股市场策略分析师。从中国A股市场特点出发，分析行业轮动、政策影响和板块表现。
输出格式：
## 🏛️ A股策略分析
### 行业地位
[该股在行业中的定位和竞争优势]
### 政策环境
[当前政策对该行业的影响]
### 市场风格
[当前市场风格（大盘/小盘/价值/成长）是否有利于该股]
### 板块轮动
[该板块在当前市场周期中的位置]
### 策略结论`;

  return callLLM(system, dataCtx);
}

// ═══════════════════════════════════════════════════════════════
// Phase 2: Bull/Bear Synthesis
// ═══════════════════════════════════════════════════════════════

async function bullResearcher(analystReports: string): Promise<string> {
  const system = `你是多方研究员。基于以下5份独立分析报告，构建最有力的看多逻辑。
要求：
1. 从每份报告中提取支持看多的论据
2. 找出多份报告中的共振信号
3. 量化目标价位（给出具体数字）
4. 列出3-5个关键催化剂

输出格式：
## 🐂 多头逻辑
### 核心论点
[2-3个核心看多理由]
### 共振信号
[多份报告中一致的看多信号]
### 目标价位
[短期/中期/长期目标价]
### 关键催化剂
[3-5个可能推动股价上涨的事件]`;

  return callLLM(system, `以下5份独立分析报告，请构建多头逻辑：\n\n${analystReports}`);
}

async function bearResearcher(analystReports: string): Promise<string> {
  const system = `你是空方研究员。基于以下5份独立分析报告，构建最有力的看空逻辑。
要求：
1. 从每份报告中提取风险点和看空论据
2. 找出多份报告中的矛盾信号
3. 量化下行风险（给出具体数字）
4. 列出3-5个关键风险

输出格式：
## 🐻 空头风险
### 核心风险
[2-3个核心看空理由]
### 矛盾信号
[多份报告中不一致的信号]
### 下行风险
[可能的最大回撤幅度]
### 关键风险事件
[3-5个可能导致下跌的事件]`;

  return callLLM(system, `以下5份独立分析报告，请构建空头逻辑：\n\n${analystReports}`);
}

// ═══════════════════════════════════════════════════════════════
// Phase 3: Risk Manager
// ═══════════════════════════════════════════════════════════════

async function riskManager(
  bullCase: string,
  bearCase: string,
  dataCtx: string,
): Promise<{ assessment: string; level: ResearchReport['riskLevel'] }> {
  const system = `你是资深风控经理。基于多头逻辑和空头风险，给出综合风险评估。
输出格式：
## ⚖️ 风险评估
### 风险等级
[低/中/高/极高]
### 最大回撤预估
[具体百分比]
### 概率分布
[上涨概率X% vs 下跌概率Y%]
### 仓位建议
[建议仓位比例]
### 止损建议
[建议止损价位]`;

  const report = await callLLM(system, `多头逻辑：\n${bullCase}\n\n空头风险：\n${bearCase}\n\n补充数据：\n${dataCtx}`);
  let level: ResearchReport['riskLevel'] = '中';
  if (report.includes('极高')) level = '极高';
  else if (report.includes('高风险') || report.includes('高风险')) level = '高';
  else if (report.includes('低风险')) level = '低';
  return { assessment: report, level };
}

// ═══════════════════════════════════════════════════════════════
// Main: Run Deep Research
// ═══════════════════════════════════════════════════════════════

export async function runDeepResearch(ctx: ResearchContext): Promise<ResearchReport | null> {
  // 密钥库未解锁时返回 null（保持原有「未配置则不研究」行为）
  try { getAiGatewayRuntime(); } catch { return null; }

  const dataCtx = buildDataContext(ctx);
  const startedAt = new Date();

  try {
    // Phase 1: 5 analysts in parallel
    const [tech, fund, sent, china] = await Promise.all([
      technicalAnalyst(dataCtx),
      fundamentalAnalyst(dataCtx),
      sentimentAnalyst(dataCtx),
      chinaMarketAnalyst(dataCtx),
    ]);

    const analystReports = [
      tech, fund, sent, china,
    ].join('\n\n---\n\n');

    // Phase 2: Bull + Bear in parallel
    const [bullCase, bearCase] = await Promise.all([
      bullResearcher(analystReports),
      bearResearcher(analystReports),
    ]);

    // Phase 3: Risk manager
    const riskResult = await riskManager(bullCase, bearCase, dataCtx);
    const riskAssessment = riskResult.assessment;
    const riskLevel: ResearchReport['riskLevel'] = riskResult.level;

    // Phase 4: Final synthesis
    const buySignalCount = ctx.strategies.filter(s => s.type === 'buy').length;
    const sellSignalCount = ctx.strategies.filter(s => s.type === 'sell').length;
    const score = ctx.fundamentals.totalScore;

    let rating: ResearchReport['rating'] = '持有';
    let ratingScore = 50;
    if (score >= 65 && buySignalCount >= 2 && sellSignalCount === 0) { rating = '强烈买入'; ratingScore = 85; }
    else if (score >= 50 && buySignalCount >= sellSignalCount) { rating = '买入'; ratingScore = 70; }
    else if (score >= 35 && sellSignalCount === 0) { rating = '持有'; ratingScore = 50; }
    else if (sellSignalCount > buySignalCount) { rating = '减持'; ratingScore = 30; }
    else if (sellSignalCount >= 2 && score < 30) { rating = '卖出'; ratingScore = 15; }

    // Extract price targets from context
    const price = ctx.stock.price;
    const priceTarget = {
      low: Math.round(price * 0.9 * 100) / 100,
      mid: Math.round(price * 1.1 * 100) / 100,
      high: Math.round(price * 1.3 * 100) / 100,
    };

    // Summary
    const summary = `综合5维度分析（技术面/基本面/情绪面/A股策略/风控），${ctx.stock.name}(${ctx.stock.code})当前评级：**${rating}**(${ratingScore}分)。` +
      (rating === '强烈买入' || rating === '买入' ? '多维度信号共振看多，建议关注。' :
       rating === '持有' ? '信号分化，建议观望等待更明确的方向。' :
       '风险信号偏多，建议谨慎。');

    return {
      rating, ratingScore,
      technicalAnalysis: tech,
      fundamentalAnalysis: fund,
      sentimentAnalysis: sent,
      chinaMarketAnalysis: china,
      bullCase, bearCase,
      riskAssessment, riskLevel,
      priceTarget,
      stopLoss: Math.round(price * 0.92 * 100) / 100,
      holdingPeriod: rating === '强烈买入' ? '中长期(3-6个月)' : rating === '买入' ? '中线(1-3个月)' : '短线(1-4周)',
      confidenceLevel: buySignalCount >= 3 ? '高' : buySignalCount >= 1 ? '中' : '低',
      keyCatalysts: ['技术面信号共振', '资金面改善', '估值修复'],
      keyRisks: ['市场系统性风险', '行业政策变化', '业绩不及预期'],
      summary,
      generatedAt: startedAt.toISOString(),
      dataSources: ['腾讯行情(qt.gtimg.cn)', '东方财富财务数据', 'InStock技术指标库', 'InStock策略回测引擎'],
    };
  } catch {
    return null;
  }
}
