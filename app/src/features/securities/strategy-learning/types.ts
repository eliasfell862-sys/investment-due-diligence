import type { StockKLine } from '../../../infrastructure/market-data/stock-api';
import type { TechnicalStrategyConfig } from './technical-strategy-config';

export type CandidateStatus =
  | 'draft'
  | 'validating'
  | 'observing'
  | 'rejected'
  | 'approval_ready'
  | 'approval_ready_with_risk'
  | 'active'
  | 'superseded'
  | 'rolled_back';

export type EvidenceKind =
  | 'fact'
  | 'calculation'
  | 'model_judgment'
  | 'hypothesis'
  | 'insufficient_evidence';

export interface ReviewEvidence {
  kind: EvidenceKind;
  label: string;
  value?: string | number;
  source?: string;
  observedAt?: string;
}

export interface ReviewFinding {
  id: string;
  title: string;
  description: string;
  evidenceKind: EvidenceKind;
  evidence: ReviewEvidence[];
  confidence: number;
}

export interface PortfolioReviewMetrics {
  returnPct: number;
  maxDrawdownPct: number;
  openPositions: number;
  transactionCost: number;
  [key: string]: number;
}

export interface ReviewDataQuality {
  completeness: number;
  blockingIssues: string[];
  warnings?: string[];
}

export interface FrozenStrategySnapshot {
  id: string;
  tradingDate: string;
  strategyId: string;
  strategyVersion: string;
  capturedAt: string;
  payload: Record<string, unknown>;
  sourceHashes?: Record<string, string>;
}
export interface StrategyLearningSnapshot extends FrozenStrategySnapshot {
  strategyConfig: TechnicalStrategyConfig;
  stocks: Record<string, { code: string; bars: StockKLine[] }>;
  watchlistCodes: string[];
  actualPositions: Array<{ code: string }>;
  virtualLedger: object;
  actualLedger?: unknown;
  marketRegime: string;
  dataSources: string[];
  dataQuality: ReviewDataQuality;
  inputHash: string;
}

export type DailyReviewStatus = 'pending' | 'running' | 'completed' | 'blocked' | 'failed';

export interface DailyStrategyReview {
  id: string;
  tradingDate: string;
  strategyId: string;
  strategyVersion: string;
  snapshotId: string;
  status: DailyReviewStatus;
  portfolioMetrics: PortfolioReviewMetrics;
  positiveFindings: ReviewFinding[];
  negativeFindings: ReviewFinding[];
  dataQuality: ReviewDataQuality;
  confidence: number;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export type DecisionType = 'buy' | 'add' | 'hold' | 'partial_sell' | 'sell' | 'missed_opportunity';

export interface TradeDecisionReview {
  id: string;
  dailyReviewId: string;
  code: string;
  virtualTradeId?: string;
  virtualCycleId?: string;
  decisionType: DecisionType;
  decisionAt: string;
  evidence: ReviewEvidence[];
  positiveFindings: ReviewFinding[];
  negativeFindings: ReviewFinding[];
  attribution: Record<string, number>;
  counterfactuals: Record<string, unknown>[];
  improvementSuggestions: ReviewFinding[];
  confidence: number;
  patternKeys: string[];
  followUpHorizons: Record<string, unknown>;
}

export interface LearningPattern {
  id: string;
  patternKey: string;
  category: string;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  affectedCodes: string[];
  affectedMarketRegimes: string[];
  estimatedReturnImpact: number;
  estimatedDrawdownImpact: number;
  evidenceStrength: number;
  candidateEligible: boolean;
  linkedCandidateId?: string;
}

export interface StrategyVersion {
  id: string;
  strategyId: string;
  version: string;
  status: CandidateStatus;
  config: TechnicalStrategyConfig;
  createdAt: string;
  basedOnVersion?: string;
}

export interface StrategyCandidate {
  id: string;
  baseStrategyId: string;
  baseStrategyVersion: string;
  candidateVersion: string;
  sourcePatternIds: string[];
  parameterChanges: Record<string, unknown>;
  weightChanges: Record<string, number>;
  ruleSuggestions: string[];
  expectedBenefits: string[];
  knownRisks: string[];
  config: TechnicalStrategyConfig;
  status: CandidateStatus;
  createdAt: string;
}

export type ValidationType = 'walk_forward' | 'out_of_sample' | 'forward' | 'stress';

export interface StrategyMetrics {
  netReturnPct: number;
  grossReturnPct: number;
  annualReturnPct: number;
  maxDrawdownPct: number;
  winRate: number;
  payoffRatio: number;
  profitFactor: number;
  sharpe: number;
  closedTrades: number;
}

export interface StrategyValidationRun {
  id: string;
  candidateId: string;
  validationType: ValidationType;
  universeSnapshotId: string;
  period: { start: string; end: string };
  costModel: Record<string, number>;
  baselineMetrics: StrategyMetrics;
  candidateMetrics: StrategyMetrics;
  marketRegimeMetrics: Record<string, StrategyMetrics>;
  leakageChecks: Record<string, boolean>;
  overfittingChecks: Record<string, boolean>;
  passed: boolean;
  failureReasons: string[];
  createdAt: string;
}

export interface ForwardObservation {
  id: string;
  candidateId: string;
  tradingDate: string;
  metrics: Partial<StrategyMetrics>;
  closedCycleIds: string[];
  updatedAt: string;
}

export type ApprovalAction = 'approve' | 'reject' | 'continue_observing' | 'rollback';

export interface StrategyApproval {
  id: string;
  candidateId: string;
  action: ApprovalAction;
  reason: string;
  operator: string;
  previousActiveVersion?: string;
  resultingActiveVersion?: string;
  acceptedRiskWarning?: boolean;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  entityType: string;
  entityId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface StrategyLearningExportV1 {
  schemaVersion: 1;
  snapshots: FrozenStrategySnapshot[];
  dailyReviews: DailyStrategyReview[];
  decisionReviews: TradeDecisionReview[];
  patterns: LearningPattern[];
  strategyVersions: StrategyVersion[];
  candidates: StrategyCandidate[];
  validationRuns: StrategyValidationRun[];
  forwardObservations: ForwardObservation[];
  approvals: StrategyApproval[];
  auditEvents: AuditEvent[];
}
