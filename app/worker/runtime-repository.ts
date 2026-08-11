import type { SignalCycleState } from '../src/engines/market-analysis/signal-cycle-state';
import type { WorkerHeartbeatStatus } from './scheduler';
import type { ScanSummary } from './scan-runner';
import type { CompleteMonitoringAssignment, WorkerRepository } from './supabase-repository';

export interface RuntimeRepositoryOptions {
  workerName: string;
  ownerId: string;
  workerVersion: string;
  assignmentRepository: WorkerRepository;
  now?: () => Date;
}

export interface WorkerRuntimeRepository {
  loadMonitoringAssignments(): Promise<CompleteMonitoringAssignment[]>;
  loadSignalState(userId: string, code: string, strategyId: string, strategyVersion: string): Promise<SignalCycleState | null>;
  saveSignalState(userId: string, state: SignalCycleState): Promise<void>;
  commitSignal(payload: Record<string, unknown>): Promise<string>;
  commitTTradeSignal(payload: Record<string, unknown>): Promise<string>;
  expireTTradeCycles(asOf: string): Promise<number>;
  recordScan(summary: ScanSummary): Promise<void>;
  claimLease(): Promise<boolean>;
  writeHeartbeat(status: WorkerHeartbeatStatus, details?: Record<string, unknown>): Promise<void>;
}

function throwOnError(result: { error?: { message: string } | null }, operation: string): void {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
}

export function createWorkerRuntimeRepository(
  client: any,
  options: RuntimeRepositoryOptions,
): WorkerRuntimeRepository {
  const now = options.now ?? (() => new Date());
  return {
    loadMonitoringAssignments: () => options.assignmentRepository.loadMonitoringAssignments(),

    async loadSignalState(userId, code, strategyId, strategyVersion) {
      const result = await client.from('signal_states')
        .select('code,strategy_id,strategy_version,buy_direction,sell_direction,buy_cycle_id,sell_cycle_id,updated_at')
        .eq('user_id', userId)
        .eq('code', code)
        .eq('strategy_id', strategyId)
        .maybeSingle();
      throwOnError(result, 'load signal state');
      if (!result.data) return null;
      return {
        code: result.data.code,
        strategyId: result.data.strategy_id,
        strategyVersion: result.data.strategy_version || strategyVersion,
        buyDirection: result.data.buy_direction,
        sellDirection: result.data.sell_direction,
        buyCycleId: result.data.buy_cycle_id,
        sellCycleId: result.data.sell_cycle_id,
        updatedAt: result.data.updated_at,
      };
    },

    async saveSignalState(userId, state) {
      const result = await client.from('signal_states').upsert({
        user_id: userId,
        code: state.code,
        strategy_id: state.strategyId,
        strategy_version: state.strategyVersion,
        buy_direction: state.buyDirection,
        sell_direction: state.sellDirection,
        buy_cycle_id: state.buyCycleId,
        sell_cycle_id: state.sellCycleId,
        pending_virtual_sell: null,
        updated_at: state.updatedAt ?? now().toISOString(),
      }, { onConflict: 'user_id,code,strategy_id' });
      throwOnError(result, 'save signal state');
    },

    async commitSignal(payload) {
      const result = await client.rpc('commit_signal_transition', { p_payload: payload });
      throwOnError(result, 'commit signal');
      if (!result.data) throw new Error('commit signal returned no alert id');
      return String(result.data);
    },

    async commitTTradeSignal(payload) {
      const result = await client.rpc('commit_t_trade_signal', { p_payload: payload });
      throwOnError(result, 'commit T-trade signal');
      if (!result.data) throw new Error('commit T-trade signal returned no alert id');
      return String(result.data);
    },

    async expireTTradeCycles(asOf) {
      const result = await client.rpc('expire_t_trade_cycles', { p_as_of: asOf });
      throwOnError(result, 'expire T-trade cycles');
      return Number(result.data ?? 0);
    },
    async recordScan(summary) {
      const finishedAt = now().toISOString();
      const result = await client.from('scan_runs').insert({
        worker_name: options.workerName,
        started_at: new Date(now().getTime() - summary.durationMs).toISOString(),
        finished_at: finishedAt,
        quote_at: summary.quoteAt,
        unique_code_count: summary.uniqueCodes,
        assignment_count: summary.assignmentCount,
        success_count: summary.successCount,
        failure_count: summary.failureCount,
        opened_signal_count: summary.openedSignals,
        duration_ms: summary.durationMs,
      });
      throwOnError(result, 'record scan');
    },

    async claimLease() {
      const result = await client.rpc('claim_worker_lease', {
        p_worker_name: options.workerName,
        p_owner_id: options.ownerId,
        p_ttl_seconds: 15,
      });
      throwOnError(result, 'claim worker lease');
      return result.data === true;
    },

    async writeHeartbeat(status, details = {}) {
      const result = await client.from('worker_heartbeats').upsert({
        worker_name: options.workerName,
        owner_id: options.ownerId,
        worker_version: options.workerVersion,
        status,
        heartbeat_at: now().toISOString(),
        details,
      }, { onConflict: 'worker_name' });
      throwOnError(result, 'write worker heartbeat');
    },
  };
}
