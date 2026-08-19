import { runBacktest } from '../src/engines/market-analysis/backtest-engine';
import { evaluateBacktestBar } from '../src/engines/market-analysis/backtest-strategy';
import { calcAllIndicators } from '../src/engines/market-analysis/technical-indicators';
import {
  createRealtimeBacktestMonitor,
  type RealtimeBacktestMonitor,
} from '../src/features/securities/realtime-backtest-monitor';
import { selectSignalTrade } from '../src/features/securities/signal-trade-recommendation';
import { estimateTradeFees } from '../src/features/securities/t-trading/trading-fee-engine';
import {
  DEFAULT_TECHNICAL_STRATEGY_CONFIG,
  type TechnicalStrategyConfig,
} from '../src/features/securities/strategy-learning/technical-strategy-config';
import type { NodeMarketDataProvider } from './market-data-provider';
import type { StatefulScanDependencies, StatefulSignalDecision } from './stateful-scan-runner';

export interface WorkerSignalEvaluatorOptions {
  marketData?: NodeMarketDataProvider;
  createMonitor?: () => RealtimeBacktestMonitor;
}

function strategyConfig(input: Record<string, unknown> | undefined, version?: string): TechnicalStrategyConfig {
  return {
    ...DEFAULT_TECHNICAL_STRATEGY_CONFIG,
    ...(input ?? {}),
    weights: {
      ...DEFAULT_TECHNICAL_STRATEGY_CONFIG.weights,
      ...((input?.weights as Partial<TechnicalStrategyConfig['weights']> | undefined) ?? {}),
    },
    version: version ?? String(input?.version ?? DEFAULT_TECHNICAL_STRATEGY_CONFIG.version),
  } as TechnicalStrategyConfig;
}

export function createWorkerSignalEvaluator(
  options: WorkerSignalEvaluatorOptions,
): StatefulScanDependencies['evaluate'] {
  const monitors = new Map<string, RealtimeBacktestMonitor>();
  const createMonitor = options.createMonitor ?? (() => {
    if (!options.marketData) throw new Error('Worker market data provider is required');
    return createRealtimeBacktestMonitor({
      fetchKLine: (code, limit) => options.marketData!.fetchHistory(code, limit),
      calculateIndicators: calcAllIndicators,
      runBacktest,
      evaluateBar: evaluateBacktestBar,
    });
  });

  return async ({ assignment, code, quote, quoteAt }) => {
    const assigned = assignment.strategies[0];
    const key = `${assignment.userId}:${code}:${assigned?.strategyId ?? DEFAULT_TECHNICAL_STRATEGY_CONFIG.strategyId}`;
    let monitor = monitors.get(key);
    if (!monitor) {
      monitor = createMonitor();
      monitors.set(key, monitor);
    }
    if (monitor.setStrategyConfig) {
      monitor.setStrategyConfig(strategyConfig(assigned?.config, assigned?.strategyVersion));
    }
    await monitor.syncUniverse([code]);
    const actual = assignment.actualPositions.find(position => position.code === code);
    const virtual = assignment.virtualPositions.find(position => position.code === code);
    const result = await monitor.processSnapshot({
      quotes: { [code]: quote },
      buyCodes: assignment.watchlistCodes,
      actualPositions: actual ? [actual] : [],
      virtualPositions: virtual ? [virtual] : [],
      tradingDate: quoteAt.slice(0, 10),
      signalAt: quoteAt,
    });
    const event = result.events[0];
    if (!event) return [];

    const virtualTrade = selectSignalTrade({
      isBuyCandidate: event.isBuyCandidate,
      isHeld: event.virtualPositionShares > 0,
      positionShares: event.virtualPositionShares,
      availableShares: event.virtualAvailableShares,
      buyDecision: event.buyDecision,
      sellDecision: event.virtualSellDecision,
    });
    const actualTrade = selectSignalTrade({
      isBuyCandidate: event.isBuyCandidate,
      isHeld: event.actualPositionShares > 0,
      positionShares: event.actualPositionShares,
      availableShares: event.actualAvailableShares,
      buyDecision: event.buyDecision,
      sellDecision: event.actualSellDecision,
    });
    const selected = virtualTrade?.action === 'sell' ? virtualTrade
      : actualTrade?.action === 'sell' ? actualTrade
      : virtualTrade ?? actualTrade;
    const position = selected === virtualTrade ? virtual : actual;
    const virtualBuyCashBlocked = selected === virtualTrade && virtualTrade?.action === 'buy'
      ? (() => {
          const fees = estimateTradeFees({
            side: 'buy', price: event.price, shares: virtualTrade.suggestedShares,
            profile: assignment.feeProfile,
            liquidity: {
              averageDailyAmount: Math.max(quote.amount, event.price * virtualTrade.suggestedShares),
              orderAmount: event.price * virtualTrade.suggestedShares,
            },
          });
          const requiredCash = event.price * virtualTrade.suggestedShares + fees.total;
          const availableCash = Math.max(0, assignment.virtualCashBalance - assignment.virtualReservedCash);
          return requiredCash > availableCash;
        })()
      : false;
    const decision: StatefulSignalDecision = {
      code: event.code,
      name: event.name,
      price: event.price,
      action: virtualBuyCashBlocked ? 'hold' : selected?.action ?? 'hold',
      intent: virtualBuyCashBlocked ? null : selected?.intent ?? null,
      suggestedShares: virtualBuyCashBlocked ? 0 : selected?.suggestedShares ?? 0,
      positionSharesAtSignal: position?.shares ?? 0,
      availableSharesAtSignal: position?.availableShares ?? 0,
      reasons: virtualBuyCashBlocked
        ? ['virtual_cash_insufficient_suppressed']
        : selected?.decision.reasons ?? [],
      metrics: { ...event.metrics },
      entryPrice: position?.averageCost ?? event.price,
      stopLoss: event.stopLoss,
      strategyId: event.strategyId,
      strategyVersion: event.strategyVersion,
      signalAt: event.signalAt,
      executeVirtualTrade: !virtualBuyCashBlocked && selected === virtualTrade && virtualTrade !== null,
    };
    return [decision];
  };
}
