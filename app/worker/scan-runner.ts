import {
  emptySignalCycleState,
  transitionSignalCycle,
  type SignalCycleAction,
  type SignalCycleIntent,
  type SignalCycleState,
} from '../src/engines/market-analysis/signal-cycle-state';
import type { StockQuote } from '../src/infrastructure/market-data/stock-api';
import { buildGlobalUniverse } from './monitoring-universe';
import type { CompleteMonitoringAssignment } from './supabase-repository';

export interface WorkerSignalCandidate {
  code: string;
  name: string;
  price: number;
  action: Exclude<SignalCycleAction, 'hold'>;
  intent: SignalCycleIntent;
  suggestedShares: number;
  positionSharesAtSignal: number;
  availableSharesAtSignal: number;
  reasons: string[];
  metrics: Record<string, unknown>;
  entryPrice: number;
  stopLoss: number;
  strategyId: string;
  strategyVersion: string;
  signalAt: string;
}

export interface ScanSummary {
  uniqueCodes: number;
  assignmentCount: number;
  successCount: number;
  failureCount: number;
  openedSignals: number;
  durationMs: number;
  quoteAt: string;
}

interface ScanRepository {
  loadMonitoringAssignments(): Promise<CompleteMonitoringAssignment[]>;
  loadSignalState(userId: string, code: string, strategyId: string, strategyVersion: string): Promise<SignalCycleState | null>;
  commitSignal(payload: Record<string, unknown>): Promise<string>;
  recordScan(summary: ScanSummary): Promise<unknown>;
}

interface ScanMarketData {
  fetchQuotes(codes: string[]): Promise<{
    quotes: Record<string, StockQuote>;
    failures: Record<string, string>;
    quoteAt: string;
  }>;
}

export interface ScanDependencies {
  repository: ScanRepository;
  marketData: ScanMarketData;
  evaluate(input: {
    assignment: CompleteMonitoringAssignment;
    code: string;
    quote: StockQuote;
    quoteAt: string;
  }): Promise<WorkerSignalCandidate[]>;
  now?: () => Date;
}

function alertPayload(
  userId: string,
  candidate: WorkerSignalCandidate,
  transition: ReturnType<typeof transitionSignalCycle>,
): Record<string, unknown> {
  return {
    user_id: userId,
    code: candidate.code,
    name: candidate.name,
    price: candidate.price,
    action: candidate.action,
    intent: candidate.intent,
    suggested_shares: candidate.suggestedShares,
    position_shares_at_signal: candidate.positionSharesAtSignal,
    available_shares_at_signal: candidate.availableSharesAtSignal,
    reasons: candidate.reasons,
    metrics: candidate.metrics,
    entry_price: candidate.entryPrice,
    stop_loss: candidate.stopLoss,
    signal_at: candidate.signalAt,
    message_kind: 'cloud_signal',
    virtual_tracking_status: 'pending',
    virtual_shares: 0,
    strategy_id: candidate.strategyId,
    strategy_version: candidate.strategyVersion,
    cycle_id: transition.cycleId,
    buy_direction: transition.state.buyDirection,
    sell_direction: transition.state.sellDirection,
    buy_cycle_id: transition.state.buyCycleId,
    sell_cycle_id: transition.state.sellCycleId,
    pending_virtual_sell: null,
  };
}

export async function runScan(deps: ScanDependencies): Promise<ScanSummary> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now().getTime();
  const assignments = await deps.repository.loadMonitoringAssignments();
  const universe = buildGlobalUniverse(assignments);
  const quoteResult = await deps.marketData.fetchQuotes(universe.codes);
  const failedCodes = new Set(Object.keys(quoteResult.failures));
  let openedSignals = 0;

  for (const assignment of assignments) {
    const projection = universe.byUser.get(assignment.userId);
    for (const code of projection?.allCodes ?? []) {
      const quote = quoteResult.quotes[code];
      if (!quote) continue;
      try {
        const candidates = await deps.evaluate({ assignment, code, quote, quoteAt: quoteResult.quoteAt });
        for (const candidate of candidates) {
          const previous = await deps.repository.loadSignalState(
            assignment.userId,
            candidate.code,
            candidate.strategyId,
            candidate.strategyVersion,
          ) ?? emptySignalCycleState(candidate.code, candidate.strategyId, candidate.strategyVersion);
          const transition = transitionSignalCycle(previous, {
            code: candidate.code,
            strategyId: candidate.strategyId,
            strategyVersion: candidate.strategyVersion,
            action: candidate.action,
            intent: candidate.intent,
            signalAt: candidate.signalAt,
          });
          if (transition.kind !== 'opened' && transition.kind !== 'reversed') continue;
          await deps.repository.commitSignal(alertPayload(assignment.userId, candidate, transition));
          openedSignals += 1;
        }
      } catch {
        failedCodes.add(code);
      }
    }
  }

  const summary: ScanSummary = {
    uniqueCodes: universe.codes.length,
    assignmentCount: assignments.length,
    successCount: Math.max(0, universe.codes.length - failedCodes.size),
    failureCount: failedCodes.size,
    openedSignals,
    durationMs: Math.max(0, now().getTime() - startedAt),
    quoteAt: quoteResult.quoteAt,
  };
  await deps.repository.recordScan(summary);
  return summary;
}
