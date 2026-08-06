import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StrategyLearningDb } from './strategy-learning-db';
import { StrategyLearningRepository } from './strategy-learning-repository';
import { StrategyApprovalService } from './strategy-approval-service';
import { DEFAULT_TECHNICAL_STRATEGY_CONFIG } from './technical-strategy-config';
import type { StrategyCandidate, StrategyValidationRun } from './types';

const candidate = (status: StrategyCandidate['status'] = 'approval_ready'): StrategyCandidate => ({
  id: 'candidate-2', baseStrategyId: 'realtime-technical', baseStrategyVersion: '1',
  candidateVersion: '2', sourcePatternIds: [], parameterChanges: { rsiBuyThreshold: 28 },
  weightChanges: {}, ruleSuggestions: [], expectedBenefits: [], knownRisks: [],
  config: { ...DEFAULT_TECHNICAL_STRATEGY_CONFIG, version: '2', rsiBuyThreshold: 28 },
  status, createdAt: '2026-08-06T08:00:00.000Z',
});

const validation = (): StrategyValidationRun => ({
  id: 'validation-2', candidateId: 'candidate-2', validationType: 'forward',
  universeSnapshotId: 'universe-1', period: { start: '2026-07-01', end: '2026-08-06' },
  costModel: {}, baselineMetrics: {} as never, candidateMetrics: {} as never,
  marketRegimeMetrics: {}, leakageChecks: { passed: true }, overfittingChecks: { passed: true },
  passed: true, failureReasons: [], createdAt: '2026-08-06T08:10:00.000Z',
});

describe('StrategyApprovalService', () => {
  let db: StrategyLearningDb; let repository: StrategyLearningRepository; let service: StrategyApprovalService;
  beforeEach(() => { db = new StrategyLearningDb(`approval-${crypto.randomUUID()}`); repository = new StrategyLearningRepository(db); service = new StrategyApprovalService(repository); });
  afterEach(async () => { await db.delete(); });

  it('falls back to formal version 1 until an approved candidate replaces it', async () => {
    expect(await service.getActiveStrategy('realtime-technical')).toMatchObject({ version: '1' });
    await repository.saveCandidate(candidate());
    await repository.saveValidationRun(validation());
    expect(await service.getActiveStrategy('realtime-technical')).toMatchObject({ version: '1' });

    await service.approveCandidate({ candidateId: 'candidate-2', reason: '验证通过', operator: 'user', acceptedRiskWarning: false });
    expect(await service.getActiveStrategy('realtime-technical')).toMatchObject({ version: '2', status: 'active' });
  });

  it('requires explicit acceptance for a higher-drawdown candidate', async () => {
    await repository.saveCandidate(candidate('approval_ready_with_risk'));
    await repository.saveValidationRun(validation());
    await expect(service.approveCandidate({ candidateId: 'candidate-2', reason: '接受升级', operator: 'user', acceptedRiskWarning: false }))
      .rejects.toThrow('必须明确接受新增回撤风险');
  });
});
