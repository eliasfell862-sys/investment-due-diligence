import type { VirtualTradingLedger, VirtualTransaction } from '../virtual-trading-ledger';
import { attributeVirtualTransaction } from './decision-attribution';
import type { StrategyLearningRepository } from './strategy-learning-repository';
import type {
  DailyStrategyReview, DecisionType, StrategyLearningSnapshot, TradeDecisionReview,
} from './types';

export interface DailyStrategyReviewInput {
  repository: StrategyLearningRepository;
  snapshot: StrategyLearningSnapshot;
  ledger: VirtualTradingLedger;
}

const transactionDecisionType = (transaction: VirtualTransaction): DecisionType => {
  if (transaction.intent === 'open') return 'buy';
  if (transaction.intent === 'add') return 'add';
  if (transaction.intent === 'reduce') return 'partial_sell';
  return 'sell';
};

export async function runDailyStrategyReview(input: DailyStrategyReviewInput) {
  const { repository, snapshot, ledger } = input;
  const existing = await repository.db.dailyReviews
    .where('[tradingDate+strategyId+strategyVersion]')
    .equals([snapshot.tradingDate, snapshot.strategyId, snapshot.strategyVersion])
    .first();
  if (existing) {
    return { review: structuredClone(existing), decisions: await repository.listDecisionReviews(existing.id) };
  }

  const transactions = ledger.transactions.filter(transaction =>
    transaction.tradedAt.slice(0, 10) === snapshot.tradingDate
    && transaction.strategyId === snapshot.strategyId
    && transaction.strategyVersion === snapshot.strategyVersion);
  const reviewId = `review-${snapshot.tradingDate}-${snapshot.strategyId}-${snapshot.strategyVersion}`;
  const decisions: TradeDecisionReview[] = transactions.map(transaction => {
    const bars = snapshot.stocks[transaction.code]?.bars ?? [];
    const last = bars.at(-1) as (typeof bars[number] & {
      rsi?: { rsi6?: number }; atr?: number;
    }) | undefined;
    const attribution = attributeVirtualTransaction({
      decisionType: transactionDecisionType(transaction), reasons: transaction.reasons,
      decisionPrice: transaction.price, closePrice: last?.close ?? transaction.price,
      atr: last?.atr ?? null, rsi6: last?.rsi?.rsi6 ?? null,
      availableShares: transaction.availableSharesAfter, existingReturnPct: 0,
      nextDayReturnPct: null, dataQualityBlockingIssues: snapshot.dataQuality.blockingIssues
        .filter(issue => issue.includes(transaction.code)),
    });
    return {
      id: `${reviewId}-${transaction.id}`, dailyReviewId: reviewId, code: transaction.code,
      virtualTradeId: transaction.id, virtualCycleId: transaction.cycleId,
      decisionType: transactionDecisionType(transaction), decisionAt: transaction.tradedAt,
      evidence: attribution.evidence, positiveFindings: attribution.positiveFindings,
      negativeFindings: attribution.negativeFindings, attribution: attribution.attribution,
      counterfactuals: [], improvementSuggestions: attribution.negativeFindings,
      confidence: attribution.confidence, patternKeys: attribution.processQuality === 'needs_improvement'
        ? ['weak-decision-rationale'] : [],
      followUpHorizons: { day1: null, day5: null, day10: null, day20: null },
    };
  });
  const positiveFindings = decisions.flatMap(decision => decision.positiveFindings);
  const negativeFindings = decisions.flatMap(decision => decision.negativeFindings);
  const completedAt = `${snapshot.tradingDate}T07:15:00.000Z`;
  const review: DailyStrategyReview = {
    id: reviewId, tradingDate: snapshot.tradingDate, strategyId: snapshot.strategyId,
    strategyVersion: snapshot.strategyVersion, snapshotId: snapshot.id,
    status: snapshot.dataQuality.blockingIssues.length ? 'blocked' : 'completed',
    portfolioMetrics: {
      returnPct: ledger.cycles.filter(cycle => cycle.closedAt?.slice(0, 10) === snapshot.tradingDate)
        .reduce((sum, cycle) => sum + (cycle.returnPct ?? 0), 0),
      maxDrawdownPct: 0, openPositions: ledger.positions.length, transactionCost: 0,
    },
    positiveFindings, negativeFindings, dataQuality: structuredClone(snapshot.dataQuality),
    confidence: decisions.length ? decisions.reduce((sum, item) => sum + item.confidence, 0) / decisions.length
      : snapshot.dataQuality.blockingIssues.length ? 0 : 0.5,
    createdAt: snapshot.capturedAt, completedAt,
  };

  await repository.db.transaction('rw', repository.db.snapshots, repository.db.dailyReviews,
    repository.db.decisionReviews, repository.db.auditEvents, async () => {
      await repository.db.snapshots.add(structuredClone(snapshot));
      await repository.db.decisionReviews.bulkAdd(structuredClone(decisions));
      await repository.db.dailyReviews.add(structuredClone(review));
      await repository.db.auditEvents.add({
        id: `audit-${reviewId}`, entityType: 'daily_review', entityId: reviewId,
        eventType: 'completed', payload: { snapshotId: snapshot.id, decisionCount: decisions.length },
        createdAt: completedAt,
      });
    });
  return { review: structuredClone(review), decisions: structuredClone(decisions) };
}
