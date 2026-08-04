import type { PortfolioCandidateAnalysis } from '../../features/securities/portfolio-candidate-analysis';
import { correlateAlignedReturns, type PairCorrelation } from './portfolio-risk-metrics';

export type PortfolioRiskLevel = 'conservative' | 'balanced' | 'aggressive';

export const PORTFOLIO_RISK_PROFILES = {
  conservative: { score: 70, volatility: 0.35, drawdown: 0.25, stockCap: 0.80, cashFloor: 0.20 },
  balanced: { score: 65, volatility: 0.50, drawdown: 0.35, stockCap: 0.90, cashFloor: 0.10 },
  aggressive: { score: 60, volatility: 0.70, drawdown: 0.50, stockCap: 1.00, cashFloor: 0.00 },
} as const;

export type PortfolioExclusionCode =
  | 'invalid_price'
  | 'trading_abnormal'
  | 'insufficient_data'
  | 'strong_sell'
  | 'liquidity'
  | 'volatility_limit'
  | 'drawdown_limit'
  | 'score_threshold'
  | 'high_correlation'
  | 'selection_limit';

export interface PortfolioExclusion {
  code: string;
  reasonCode: PortfolioExclusionCode;
  reason: string;
}

export interface PortfolioSelectionResult {
  selected: PortfolioCandidateAnalysis[];
  excluded: PortfolioExclusion[];
  highCorrelationPairs: PairCorrelation[];
}

function exclusion(candidate: PortfolioCandidateAnalysis, riskLevel: PortfolioRiskLevel): PortfolioExclusion | null {
  const profile = PORTFOLIO_RISK_PROFILES[riskLevel];
  if (!Number.isFinite(candidate.quote.price) || candidate.quote.price <= 0) {
    return { code: candidate.code, reasonCode: 'invalid_price', reason: '最新价格无效' };
  }
  if (/^\*?ST/i.test(candidate.name) || /^\*?ST/i.test(candidate.quote.name)) {
    return { code: candidate.code, reasonCode: 'trading_abnormal', reason: '股票处于特别处理或异常交易状态' };
  }
  if (!candidate.dataCompleteness.quote || !candidate.dataCompleteness.kline || candidate.returns.length < 60) {
    return { code: candidate.code, reasonCode: 'insufficient_data', reason: '有效行情或历史数据不足' };
  }
  const sellSignals = candidate.strategies.filter(item => item.type === 'sell').length;
  const bearishPatterns = candidate.patterns.filter(item => item.type === 'bearish').length;
  if (candidate.mediumTermAdvice.action === 'risk_avoidance' || (sellSignals >= 1 && bearishPatterns >= 1) || bearishPatterns >= 2) {
    return { code: candidate.code, reasonCode: 'strong_sell', reason: '中期建议或策略组合出现强卖出信号' };
  }
  if (!Number.isFinite(candidate.quote.amount) || candidate.quote.amount < 100
    || !Number.isFinite(candidate.quote.volume) || candidate.quote.volume < 100) {
    return { code: candidate.code, reasonCode: 'liquidity', reason: '成交活跃度不足，难以稳健执行整手交易' };
  }
  if (!Number.isFinite(candidate.risk.annualizedVolatility) || candidate.risk.annualizedVolatility > profile.volatility) {
    return { code: candidate.code, reasonCode: 'volatility_limit', reason: `年化波动率超过${Math.round(profile.volatility * 100)}%上限` };
  }
  if (!Number.isFinite(candidate.risk.maximumDrawdown) || candidate.risk.maximumDrawdown > profile.drawdown) {
    return { code: candidate.code, reasonCode: 'drawdown_limit', reason: `最大回撤超过${Math.round(profile.drawdown * 100)}%上限` };
  }
  return null;
}

function rank(left: PortfolioCandidateAnalysis, right: PortfolioCandidateAnalysis): number {
  return right.score - left.score
    || right.confidence - left.confidence
    || left.risk.annualizedVolatility - right.risk.annualizedVolatility
    || left.code.localeCompare(right.code);
}

function sameClassification(left: PortfolioCandidateAnalysis, right: PortfolioCandidateAnalysis): boolean {
  if (left.classificationStatus === 'official' && right.classificationStatus === 'official') {
    return Boolean(left.industry && right.industry && left.industry === right.industry);
  }
  if (left.industry && right.industry) return left.industry === right.industry;
  const rightLabels = new Set(right.labels);
  return left.labels.some(label => rightLabels.has(label));
}

export function selectPortfolioCandidates(
  candidates: PortfolioCandidateAnalysis[],
  riskLevel: PortfolioRiskLevel,
): PortfolioSelectionResult {
  const excluded: PortfolioExclusion[] = [];
  const survivors: PortfolioCandidateAnalysis[] = [];
  for (const candidate of candidates) {
    const reason = exclusion(candidate, riskLevel);
    if (reason) excluded.push(reason);
    else survivors.push(candidate);
  }

  const ranked = [...survivors].sort(rank);
  const highCorrelationPairs: PairCorrelation[] = [];
  const removedForCorrelation = new Set<string>();
  for (let leftIndex = 0; leftIndex < ranked.length; leftIndex += 1) {
    const left = ranked[leftIndex];
    if (removedForCorrelation.has(left.code)) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < ranked.length; rightIndex += 1) {
      const right = ranked[rightIndex];
      if (removedForCorrelation.has(right.code)) continue;
      const aligned = correlateAlignedReturns(left.returns, right.returns);
      if (aligned.correlation === null || aligned.correlation < 0.8) continue;
      highCorrelationPairs.push({
        leftCode: left.code,
        rightCode: right.code,
        commonDays: aligned.commonDays,
        correlation: aligned.correlation,
      });
      if (sameClassification(left, right)) {
        removedForCorrelation.add(right.code);
        excluded.push({
          code: right.code,
          reasonCode: 'high_correlation',
          reason: `与更高排名候选${left.code}高度相关且分类重合`,
        });
      }
    }
  }

  const correlationFiltered = ranked.filter(item => !removedForCorrelation.has(item.code));
  const selected = correlationFiltered.slice(0, 10);
  for (const candidate of correlationFiltered.slice(10)) {
    excluded.push({ code: candidate.code, reasonCode: 'selection_limit', reason: '综合排名未进入前10名' });
  }

  return { selected, excluded, highCorrelationPairs };
}
