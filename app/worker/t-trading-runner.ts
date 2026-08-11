import type { StockQuote } from '../src/infrastructure/market-data/stock-api';
import type { NodeMarketDataProvider } from './market-data-provider';
import type { CompleteMonitoringAssignment, WorkerPositionSnapshot } from './supabase-repository';
import type {
  WorkerTTradingDecision,
  WorkerTTradingEvaluationInput,
} from './t-trading-evaluator';

interface TTradingRunnerRepository {
  loadMonitoringAssignments(): Promise<CompleteMonitoringAssignment[]>;
  commitTTradeSignal(payload: Record<string, unknown>): Promise<string>;
  expireTTradeCycles(asOf: string): Promise<number>;
}

export interface TTradingScanDependencies {
  repository: TTradingRunnerRepository;
  marketData: Pick<NodeMarketDataProvider, 'fetchQuotes'>;
  evaluate(input: WorkerTTradingEvaluationInput): Promise<WorkerTTradingDecision | null>;
}

export interface TTradingScanSummary {
  candidateCount: number;
  successCount: number;
  failureCount: number;
  openedSignals: number;
  expiredCycles: number;
  quoteAt: string;
}

function shanghaiMinuteOfDay(isoTimestamp: string): number {
  const time = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(time)) return -1;
  const shanghai = new Date(time + 8 * 60 * 60 * 1000);
  return shanghai.getUTCHours() * 60 + shanghai.getUTCMinutes();
}

function uniquePositions(assignments: CompleteMonitoringAssignment[]): WorkerPositionSnapshot[] {
  const result = new Map<string, WorkerPositionSnapshot>();
  for (const assignment of assignments) {
    for (const position of assignment.actualPositions) {
      result.set(assignment.userId + ':' + position.id, position);
    }
  }
  return [...result.values()];
}

export async function runTTradingScan(
  deps: TTradingScanDependencies,
): Promise<TTradingScanSummary> {
  const assignments = await deps.repository.loadMonitoringAssignments();
  const positions = uniquePositions(assignments);
  const codes = [...new Set(positions.map(position => position.code))].sort();
  const market = await deps.marketData.fetchQuotes(codes);
  let successCount = 0;
  let failureCount = Object.keys(market.failures).length;
  let openedSignals = 0;

  for (const assignment of assignments) {
    for (const position of assignment.actualPositions) {
      const quote = market.quotes[position.code] as StockQuote | undefined;
      if (!quote) continue;
      const cycle = assignment.openTTradeCycles
        .filter(item => item.positionId === position.id)
        .sort((left, right) => left.id.localeCompare(right.id))[0] ?? null;
      try {
        const decision = await deps.evaluate({
          assignment,
          position,
          cycle,
          quote,
          quoteAt: market.quoteAt,
        });
        if (decision) {
          await deps.repository.commitTTradeSignal(decision.payload);
          openedSignals += 1;
        }
        successCount += 1;
      } catch {
        failureCount += 1;
      }
    }
  }

  const expiredCycles = shanghaiMinuteOfDay(market.quoteAt) >= 15 * 60
    ? await deps.repository.expireTTradeCycles(market.quoteAt)
    : 0;
  return {
    candidateCount: positions.length,
    successCount,
    failureCount,
    openedSignals,
    expiredCycles,
    quoteAt: market.quoteAt,
  };
}
