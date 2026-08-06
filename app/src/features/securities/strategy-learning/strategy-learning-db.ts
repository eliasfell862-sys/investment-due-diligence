import Dexie, { type EntityTable } from 'dexie';
import type {
  AuditEvent,
  DailyStrategyReview,
  ForwardObservation,
  FrozenStrategySnapshot,
  LearningPattern,
  StrategyApproval,
  StrategyCandidate,
  StrategyValidationRun,
  StrategyVersion,
  TradeDecisionReview,
} from './types';

export class StrategyLearningDb extends Dexie {
  snapshots!: EntityTable<FrozenStrategySnapshot, 'id'>;
  dailyReviews!: EntityTable<DailyStrategyReview, 'id'>;
  decisionReviews!: EntityTable<TradeDecisionReview, 'id'>;
  patterns!: EntityTable<LearningPattern, 'id'>;
  strategyVersions!: EntityTable<StrategyVersion, 'id'>;
  candidates!: EntityTable<StrategyCandidate, 'id'>;
  validationRuns!: EntityTable<StrategyValidationRun, 'id'>;
  forwardObservations!: EntityTable<ForwardObservation, 'id'>;
  approvals!: EntityTable<StrategyApproval, 'id'>;
  auditEvents!: EntityTable<AuditEvent, 'id'>;

  constructor(name = 'securities-strategy-learning') {
    super(name);
    this.version(1).stores({
      snapshots: 'id, &[tradingDate+strategyId+strategyVersion], tradingDate',
      dailyReviews: 'id, &[tradingDate+strategyId+strategyVersion], status',
      decisionReviews: 'id, dailyReviewId, code, virtualTradeId, virtualCycleId',
      patterns: 'id, &patternKey, lastSeenAt, candidateEligible',
      strategyVersions: 'id, &[strategyId+version], strategyId, status',
      candidates: 'id, &[baseStrategyId+candidateVersion], status',
      validationRuns: 'id, candidateId, validationType, createdAt',
      forwardObservations: 'id, &[candidateId+tradingDate], candidateId',
      approvals: 'id, candidateId, action, createdAt',
      auditEvents: 'id, [entityType+entityId], eventType, createdAt',
    });
  }
}

export const strategyLearningDb = new StrategyLearningDb();
