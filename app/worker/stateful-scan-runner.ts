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
import type { ScanSummary } from './scan-runner';

export interface StatefulSignalDecision {
  code: string;
  name: string;
  price: number;
  action: SignalCycleAction;
  intent: SignalCycleIntent | null;
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
  executeVirtualTrade?: boolean;
}

interface StatefulRepository {
  loadMonitoringAssignments(): Promise<CompleteMonitoringAssignment[]>;
  loadSignalState(userId: string, code: string, strategyId: string, strategyVersion: string): Promise<SignalCycleState | null>;
  saveSignalState(userId: string, state: SignalCycleState): Promise<void>;
  commitSignal(payload: Record<string, unknown>): Promise<string>;
  recordScan(summary: ScanSummary): Promise<unknown>;
}

export interface StatefulScanDependencies {
  repository: StatefulRepository;
  marketData: {
    fetchQuotes(codes: string[]): Promise<{
      quotes: Record<string, StockQuote>;
      failures: Record<string, string>;
      quoteAt: string;
    }>;
  };
  evaluate(input: {
    assignment: CompleteMonitoringAssignment;
    code: string;
    quote: StockQuote;
    quoteAt: string;
  }): Promise<StatefulSignalDecision[]>;
  now?: () => Date;
}

function payloadFor(userId: string, decision: StatefulSignalDecision, state: SignalCycleState): Record<string, unknown> {
  const cycleId = decision.action === 'buy' ? state.buyCycleId : state.sellCycleId;
  const executeVirtualTrade = decision.executeVirtualTrade === true;
  return {
    user_id: userId, code: decision.code, name: decision.name, price: decision.price,
    action: decision.action, intent: decision.intent, suggested_shares: decision.suggestedShares,
    position_shares_at_signal: decision.positionSharesAtSignal,
    available_shares_at_signal: decision.availableSharesAtSignal,
    reasons: decision.reasons, metrics: decision.metrics, entry_price: decision.entryPrice,
    stop_loss: decision.stopLoss, signal_at: decision.signalAt,
    message_kind: executeVirtualTrade ? 'cloud_signal' : 'actual_position_risk',
    virtual_tracking_status: executeVirtualTrade ? 'pending' : 'actual_risk_only',
    virtual_execution_requested: executeVirtualTrade, virtual_shares: 0,
    strategy_id: decision.strategyId, strategy_version: decision.strategyVersion, cycle_id: cycleId,
    buy_direction: state.buyDirection, sell_direction: state.sellDirection,
    buy_cycle_id: state.buyCycleId, sell_cycle_id: state.sellCycleId, pending_virtual_sell: null,
  };
}

export async function runStatefulScan(deps: StatefulScanDependencies): Promise<ScanSummary> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now().getTime();
  const assignments = await deps.repository.loadMonitoringAssignments();
  const universe = buildGlobalUniverse(assignments);
  const market = await deps.marketData.fetchQuotes(universe.codes);
  const failures = new Set(Object.keys(market.failures));
  let openedSignals = 0;

  for (const assignment of assignments) {
    for (const code of universe.byUser.get(assignment.userId)?.allCodes ?? []) {
      const quote = market.quotes[code];
      if (!quote) continue;
      try {
        const decisions = await deps.evaluate({ assignment, code, quote, quoteAt: market.quoteAt });
        for (const decision of decisions) {
          const previous = await deps.repository.loadSignalState(
            assignment.userId, decision.code, decision.strategyId, decision.strategyVersion,
          ) ?? emptySignalCycleState(decision.code, decision.strategyId, decision.strategyVersion);
          const transition = transitionSignalCycle(previous, {
            code: decision.code, strategyId: decision.strategyId, strategyVersion: decision.strategyVersion,
            action: decision.action, intent: decision.intent, signalAt: decision.signalAt,
          });
          if (transition.kind === 'closed') {
            await deps.repository.saveSignalState(assignment.userId, transition.state);
          } else if ((transition.kind === 'opened' || transition.kind === 'reversed') && decision.action !== 'hold') {
            await deps.repository.commitSignal(payloadFor(assignment.userId, decision, transition.state));
            openedSignals += 1;
          }
        }
      } catch {
        failures.add(code);
      }
    }
  }

  const summary: ScanSummary = {
    uniqueCodes: universe.codes.length,
    assignmentCount: assignments.length,
    successCount: Math.max(0, universe.codes.length - failures.size),
    failureCount: failures.size,
    openedSignals,
    durationMs: Math.max(0, now().getTime() - startedAt),
    quoteAt: market.quoteAt,
  };
  await deps.repository.recordScan(summary);
  return summary;
}
