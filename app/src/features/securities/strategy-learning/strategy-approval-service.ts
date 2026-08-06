import { DEFAULT_TECHNICAL_STRATEGY_CONFIG, validateTechnicalStrategyConfig,
  type TechnicalStrategyConfig } from './technical-strategy-config';
import type { StrategyLearningRepository } from './strategy-learning-repository';
import type { StrategyApproval, StrategyVersion } from './types';

export interface ApproveCandidateInput {
  candidateId: string;
  reason: string;
  operator: string;
  acceptedRiskWarning: boolean;
}

const asConfig = (value: unknown): TechnicalStrategyConfig =>
  validateTechnicalStrategyConfig(value as TechnicalStrategyConfig);

export class StrategyApprovalService {
  readonly repository: StrategyLearningRepository;
  readonly now: () => string;

  constructor(repository: StrategyLearningRepository, now = () => new Date().toISOString()) {
    this.repository = repository;
    this.now = now;
  }

  async getActiveStrategy(strategyId: string): Promise<StrategyVersion> {
    const stored = await this.repository.db.strategyVersions.where('strategyId').equals(strategyId)
      .filter(version => version.status === 'active').toArray();
    const active = stored.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (active) return structuredClone(active);
    return {
      id: `${strategyId}-1-default`, strategyId, version: '1', status: 'active',
      config: structuredClone(DEFAULT_TECHNICAL_STRATEGY_CONFIG), createdAt: '2026-08-06T00:00:00.000Z',
    };
  }

  async approveCandidate(input: ApproveCandidateInput): Promise<StrategyApproval> {
    if (!input.reason.trim()) throw new Error('必须填写审批理由');
    const candidate = await this.repository.db.candidates.get(input.candidateId);
    if (!candidate) throw new Error('候选策略不存在');
    if (!['approval_ready', 'approval_ready_with_risk'].includes(candidate.status)) {
      throw new Error('候选策略尚未达到审批条件');
    }
    if (candidate.status === 'approval_ready_with_risk' && !input.acceptedRiskWarning) {
      throw new Error('必须明确接受新增回撤风险');
    }
    const validation = (await this.repository.db.validationRuns.where('candidateId')
      .equals(candidate.id).toArray()).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (!validation?.passed) throw new Error('候选策略尚未通过最新验证');
    const config = asConfig(candidate.config);
    const active = await this.getActiveStrategy(candidate.baseStrategyId);
    const createdAt = this.now();
    const approval: StrategyApproval = {
      id: `approval-${candidate.id}-${createdAt}`, candidateId: candidate.id, action: 'approve',
      reason: input.reason.trim(), operator: input.operator,
      previousActiveVersion: active.version, resultingActiveVersion: candidate.candidateVersion,
      acceptedRiskWarning: input.acceptedRiskWarning, createdAt,
    };
    const next: StrategyVersion = {
      id: `${candidate.baseStrategyId}-${candidate.candidateVersion}-${createdAt}`,
      strategyId: candidate.baseStrategyId, version: candidate.candidateVersion,
      status: 'active', config: { ...config, version: candidate.candidateVersion },
      createdAt, basedOnVersion: candidate.baseStrategyVersion,
    };
    await this.repository.db.transaction('rw', this.repository.db.strategyVersions,
      this.repository.db.candidates, this.repository.db.approvals, this.repository.db.auditEvents, async () => {
        const currentRows = await this.repository.db.strategyVersions.where('strategyId')
          .equals(candidate.baseStrategyId).filter(version => version.status === 'active').toArray();
        await Promise.all(currentRows.map(version => this.repository.db.strategyVersions.update(version.id, { status: 'superseded' })));
        await this.repository.db.strategyVersions.add(next);
        await this.repository.db.candidates.update(candidate.id, { status: 'active' });
        await this.repository.db.approvals.add(approval);
        await this.repository.db.auditEvents.add({
          id: `audit-${approval.id}`, entityType: 'strategy_version', entityId: next.id,
          eventType: 'approved', payload: { candidateId: candidate.id, previousVersion: active.version }, createdAt,
        });
      });
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('sec-strategy-version-changed'));
    return structuredClone(approval);
  }

  async rollback(strategyId: string, targetVersion: string, reason: string, operator: string) {
    if (!reason.trim()) throw new Error('必须填写回滚理由');
    const target = await this.repository.db.strategyVersions.where('[strategyId+version]')
      .equals([strategyId, targetVersion]).first();
    if (!target) throw new Error('目标策略版本不存在');
    const current = await this.getActiveStrategy(strategyId);
    const createdAt = this.now();
    const rollbackVersion = `${current.version}-rollback-${targetVersion}`;
    const next: StrategyVersion = { ...structuredClone(target), id: `${strategyId}-${rollbackVersion}-${createdAt}`,
      version: rollbackVersion, status: 'active', createdAt, basedOnVersion: current.version };
    await this.repository.db.transaction('rw', this.repository.db.strategyVersions,
      this.repository.db.approvals, this.repository.db.auditEvents, async () => {
        const rows = await this.repository.db.strategyVersions.where('strategyId').equals(strategyId)
          .filter(version => version.status === 'active').toArray();
        await Promise.all(rows.map(version => this.repository.db.strategyVersions.update(version.id, { status: 'rolled_back' })));
        await this.repository.db.strategyVersions.add(next);
        await this.repository.db.approvals.add({ id: `approval-${next.id}`, candidateId: '', action: 'rollback',
          reason: reason.trim(), operator, previousActiveVersion: current.version,
          resultingActiveVersion: rollbackVersion, createdAt });
        await this.repository.db.auditEvents.add({ id: `audit-${next.id}`, entityType: 'strategy_version',
          entityId: next.id, eventType: 'rolled_back', payload: { targetVersion }, createdAt });
      });
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('sec-strategy-version-changed'));
    return next;
  }
}
