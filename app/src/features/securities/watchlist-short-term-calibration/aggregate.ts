import type { ShortTermAdviceAction } from '../../../engines/market-analysis/short-term-trading-advice';
import {
  WATCHLIST_SHORT_TERM_CALIBRATION_MODEL,
  type AggregateCalibrationInput,
  type CalibrationBuyAction,
  type CalibrationMetricSelection,
  type CalibrationMetrics,
  type CalibrationTrade,
  type CalibrationTrust,
  type CalibrationUnfilledSignal,
  type WatchlistShortTermCalibrationResult,
} from './types';

function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percent(numerator: number, denominator: number): number {
  return denominator > 0 ? round(numerator / denominator * 100) : 0;
}

function maximumDrawdown(trades: CalibrationTrade[]): number {
  const ordered = [...trades].sort((left, right) =>
    left.exitDate.localeCompare(right.exitDate) || left.signalDate.localeCompare(right.signalDate));
  let equity = 1;
  let peak = 1;
  let maximum = 0;
  for (const trade of ordered) {
    equity *= Math.max(0, 1 + trade.netReturnPct / 100);
    peak = Math.max(peak, equity);
    maximum = Math.max(maximum, peak > 0 ? (peak - equity) / peak * 100 : 0);
  }
  return round(maximum);
}

function metrics(
  trades: CalibrationTrade[],
  unfilled: CalibrationUnfilledSignal[],
): CalibrationMetrics {
  const signalCount = trades.length + unfilled.length;
  const wins = trades.filter(trade => trade.won).length;
  const gains = trades.filter(trade => trade.netPnl > 0)
    .reduce((sum, trade) => sum + trade.netPnl, 0);
  const losses = Math.abs(trades.filter(trade => trade.netPnl < 0)
    .reduce((sum, trade) => sum + trade.netPnl, 0));
  return {
    signalCount,
    completedTrades: trades.length,
    fillRate: percent(trades.length, signalCount),
    winRate: percent(wins, trades.length),
    averageNetReturnPct: trades.length
      ? round(trades.reduce((sum, trade) => sum + trade.netReturnPct, 0) / trades.length)
      : 0,
    maxDrawdownPct: maximumDrawdown(trades),
    profitFactor: losses > 0 ? round(gains / losses) : null,
    firstTakeProfitRate: percent(
      trades.filter(trade => trade.exitReason === 'take_profit_1').length,
      trades.length,
    ),
    secondTakeProfitPathRate: percent(
      trades.filter(trade => trade.secondTakeProfitReached).length,
      trades.length,
    ),
    stopLossRate: percent(
      trades.filter(trade => trade.exitReason === 'stop_loss').length,
      trades.length,
    ),
    maxHoldingExitRate: percent(
      trades.filter(trade => trade.exitReason === 'max_holding').length,
      trades.length,
    ),
    unfilledRate: percent(unfilled.length, signalCount),
  };
}

function trustFor(input: AggregateCalibrationInput, coverageRate: number, proxyCount: number): CalibrationTrust {
  if (input.leakageBlocked) return 'blocked';
  if (coverageRate < 70 || input.trades.length < 20) return 'insufficient';
  if (input.trades.length < 100 || proxyCount > 0) return 'preliminary';
  return 'established';
}

export function aggregateCalibrationResult(
  input: AggregateCalibrationInput,
): WatchlistShortTermCalibrationResult {
  const validStockCount = input.validStocks.length;
  const coverageRate = percent(validStockCount, input.totalStocks);
  const proxyStockCount = input.validStocks.filter(stock => stock.turnoverMode === 'proxy').length;
  const directStockCount = validStockCount - proxyStockCount;
  const overall = metrics(input.trades, input.unfilled);
  const warnings: string[] = [];
  if (overall.averageNetReturnPct < 0
    || (overall.profitFactor !== null && overall.profitFactor < 1)) {
    warnings.push('盈亏结构不佳');
  }
  if (proxyStockCount > 0) warnings.push('代理换手率口径限制可信度最高为初步证据');

  const byAction = Object.fromEntries(
    (['strong_buy', 'buy_on_dip'] as CalibrationBuyAction[]).map(action => [
      action,
      metrics(
        input.trades.filter(trade => trade.action === action),
        input.unfilled.filter(item => item.action === action),
      ),
    ]),
  ) as Record<CalibrationBuyAction, CalibrationMetrics>;

  return {
    modelVersion: WATCHLIST_SHORT_TERM_CALIBRATION_MODEL,
    createdAt: input.createdAt,
    dataAsOf: input.dataAsOf,
    trust: trustFor(input, coverageRate, proxyStockCount),
    coverageRate,
    validStockCount,
    skippedStockCount: input.skippedStocks.length,
    directStockCount,
    proxyStockCount,
    directStockRate: percent(directStockCount, validStockCount),
    overall,
    byAction,
    skippedStocks: [...input.skippedStocks],
    trades: [...input.trades],
    unfilled: [...input.unfilled],
    warnings,
  };
}

export function selectCalibrationMetricsForAction(
  result: WatchlistShortTermCalibrationResult,
  action: ShortTermAdviceAction,
): CalibrationMetricSelection {
  if (action !== 'strong_buy' && action !== 'buy_on_dip') {
    return { scope: 'not_applicable', metrics: null };
  }
  const actionMetrics = result.byAction[action];
  return actionMetrics.completedTrades >= 20
    ? { scope: 'action_group', metrics: actionMetrics }
    : { scope: 'overall_fallback', metrics: result.overall };
}

