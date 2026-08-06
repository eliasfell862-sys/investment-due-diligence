import type { StrategyLearningDb } from './strategy-learning-db';
import type {
  AuditEvent,
  DailyStrategyReview,
  ForwardObservation,
  StrategyLearningSnapshot,
  LearningPattern,
  StrategyApproval,
  StrategyCandidate,
  StrategyLearningExportV1,
  StrategyValidationRun,
  StrategyVersion,
  TradeDecisionReview,
} from './types';

const clone = <T>(value: T): T => structuredClone(value);
const byId = <T extends { id: string }>(left: T, right: T) => left.id.localeCompare(right.id);

export class StrategyLearningRepository {
  readonly db: StrategyLearningDb;

  constructor(db: StrategyLearningDb) {
    this.db = db;
  }

  async saveSnapshot(value: StrategyLearningSnapshot) {
    await this.db.snapshots.add(clone(value));
    return clone(value);
  }

  async getSnapshot(id: string) { return clone(await this.db.snapshots.get(id)); }
  async listSnapshots() { return clone((await this.db.snapshots.toArray()).sort(byId)); }

  async saveDailyReview(value: DailyStrategyReview) {
    try {
      await this.db.dailyReviews.add(clone(value));
      return clone(value);
    } catch (error) {
      if ((error as Error).name === 'ConstraintError') {
        throw new Error('该交易日和策略版本已经完成复盘');
      }
      throw error;
    }
  }

  async getDailyReview(id: string) { return clone(await this.db.dailyReviews.get(id)); }
  async listDailyReviews() { return clone((await this.db.dailyReviews.toArray()).sort(byId)); }

  async saveDecisionReview(value: TradeDecisionReview) { await this.db.decisionReviews.put(clone(value)); return clone(value); }
  async getDecisionReview(id: string) { return clone(await this.db.decisionReviews.get(id)); }
  async listDecisionReviews(dailyReviewId?: string) {
    const values = dailyReviewId
      ? await this.db.decisionReviews.where('dailyReviewId').equals(dailyReviewId).toArray()
      : await this.db.decisionReviews.toArray();
    return clone(values.sort(byId));
  }

  async savePattern(value: LearningPattern) { await this.db.patterns.put(clone(value)); return clone(value); }
  async getPattern(id: string) { return clone(await this.db.patterns.get(id)); }
  async listPatterns() { return clone((await this.db.patterns.toArray()).sort(byId)); }

  async saveStrategyVersion(value: StrategyVersion) { await this.db.strategyVersions.put(clone(value)); return clone(value); }
  async getStrategyVersion(id: string) { return clone(await this.db.strategyVersions.get(id)); }
  async listStrategyVersions() { return clone((await this.db.strategyVersions.toArray()).sort(byId)); }

  async saveCandidate(value: StrategyCandidate) { await this.db.candidates.put(clone(value)); return clone(value); }
  async getCandidate(id: string) { return clone(await this.db.candidates.get(id)); }
  async listCandidates() { return clone((await this.db.candidates.toArray()).sort(byId)); }

  async saveValidationRun(value: StrategyValidationRun) { await this.db.validationRuns.put(clone(value)); return clone(value); }
  async getValidationRun(id: string) { return clone(await this.db.validationRuns.get(id)); }
  async listValidationRuns(candidateId?: string) {
    const values = candidateId
      ? await this.db.validationRuns.where('candidateId').equals(candidateId).toArray()
      : await this.db.validationRuns.toArray();
    return clone(values.sort(byId));
  }

  async saveForwardObservation(value: ForwardObservation) { await this.db.forwardObservations.put(clone(value)); return clone(value); }
  async getForwardObservation(id: string) { return clone(await this.db.forwardObservations.get(id)); }
  async listForwardObservations(candidateId?: string) {
    const values = candidateId
      ? await this.db.forwardObservations.where('candidateId').equals(candidateId).toArray()
      : await this.db.forwardObservations.toArray();
    return clone(values.sort(byId));
  }

  async saveApproval(value: StrategyApproval) { await this.db.approvals.add(clone(value)); return clone(value); }
  async getApproval(id: string) { return clone(await this.db.approvals.get(id)); }
  async listApprovals(candidateId?: string) {
    const values = candidateId
      ? await this.db.approvals.where('candidateId').equals(candidateId).toArray()
      : await this.db.approvals.toArray();
    return clone(values.sort(byId));
  }

  async appendAudit(value: AuditEvent) {
    try {
      await this.db.auditEvents.add(clone(value));
      return clone(value);
    } catch (error) {
      if ((error as Error).name === 'ConstraintError') {
        throw new Error('审计事件只允许追加');
      }
      throw error;
    }
  }

  async listAuditEvents(entityType?: string, entityId?: string) {
    const values = entityType && entityId
      ? await this.db.auditEvents.where('[entityType+entityId]').equals([entityType, entityId]).toArray()
      : await this.db.auditEvents.toArray();
    return clone(values.sort(byId));
  }

  async exportBundle(): Promise<StrategyLearningExportV1> {
    const [snapshots, dailyReviews, decisionReviews, patterns, strategyVersions,
      candidates, validationRuns, forwardObservations, approvals, auditEvents] = await Promise.all([
      this.listSnapshots(), this.listDailyReviews(), this.listDecisionReviews(), this.listPatterns(),
      this.listStrategyVersions(), this.listCandidates(), this.listValidationRuns(),
      this.listForwardObservations(), this.listApprovals(), this.listAuditEvents(),
    ]);
    return { schemaVersion: 1, snapshots, dailyReviews, decisionReviews, patterns,
      strategyVersions, candidates, validationRuns, forwardObservations, approvals, auditEvents };
  }
}

export const isStrategyLearningRepository = (value: unknown): value is StrategyLearningRepository =>
  value instanceof StrategyLearningRepository;
