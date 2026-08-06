import type { StockKLine } from '../../infrastructure/market-data/stock-api';
import {
  DEFAULT_TECHNICAL_STRATEGY_CONFIG,
  type TechnicalStrategyConfig,
} from '../../features/securities/strategy-learning/technical-strategy-config';

export interface BacktestPositionState {
  inPosition: boolean;
  entryPrice?: number;
  entryIndex?: number;
}

export interface BacktestStrategyOptions {
  stopLossPct: number;
  maxHoldingDays: number;
}

export interface BacktestBarDecision {
  action: 'buy' | 'sell' | 'hold';
  reasons: string[];
  exitReason?: 'signal' | 'stop_loss' | 'timeout';
}

type IndicatorLine = StockKLine & Record<string, any>;
type ScoredSignal = { reason: string; score: number };
const reachesThreshold = (signals: ScoredSignal[], threshold: number) => signals.reduce((total, signal) => total + signal.score, 0) >= threshold;
const signalReasons = (signals: ScoredSignal[]) => signals.filter(signal => signal.score > 0).map(signal => signal.reason);

export function evaluateConfiguredBacktestBar(
  klines: StockKLine[], index: number, position: BacktestPositionState, config: TechnicalStrategyConfig,
): BacktestBarDecision {
  if (index <= 0 || index >= klines.length) return { action: 'hold', reasons: [] };
  const current = klines[index] as IndicatorLine;
  const previous = klines[index - 1] as IndicatorLine;

  if (!position.inPosition) {
    const signals: ScoredSignal[] = [];
    if (current.macd && previous.macd && previous.macd.dif <= previous.macd.dea && current.macd.dif > current.macd.dea) signals.push({ reason: 'MACD金叉', score: config.weights.macd });
    if (current.kdj?.j < config.kdjBuyThreshold) signals.push({ reason: 'KDJ超卖', score: config.weights.kdj });
    if (current.rsi?.rsi6 < config.rsiBuyThreshold) signals.push({ reason: 'RSI超卖', score: config.weights.rsi });
    if (current.boll && current.close <= current.boll.lower * (1 + config.bollTolerancePct / 100)) signals.push({ reason: '触及布林下轨', score: config.weights.boll });
    if (current.ma && previous.ma && previous.close <= previous.ma.ma20 && current.close > current.ma.ma20) signals.push({ reason: '突破MA20', score: config.weights.ma20 });
    return reachesThreshold(signals, config.buyScoreThreshold) ? { action: 'buy', reasons: signalReasons(signals) } : { action: 'hold', reasons: [] };
  }

  const entryPrice = position.entryPrice ?? current.close;
  const entryIndex = position.entryIndex ?? index;
  const returnPct = entryPrice > 0 ? (current.close - entryPrice) / entryPrice * 100 : 0;
  if (returnPct <= -config.stopLossPct) return { action: 'sell', reasons: ['止损'], exitReason: 'stop_loss' };
  if (index - entryIndex >= config.maxHoldingDays) return { action: 'sell', reasons: ['最长持仓期'], exitReason: 'timeout' };

  const signals: ScoredSignal[] = [];
  if (current.macd && previous.macd && previous.macd.dif >= previous.macd.dea && current.macd.dif < current.macd.dea) signals.push({ reason: 'MACD死叉', score: config.weights.macd });
  if (current.kdj?.j > config.kdjSellThreshold) signals.push({ reason: 'KDJ超买', score: config.weights.kdj });
  return reachesThreshold(signals, config.sellScoreThreshold)
    ? { action: 'sell', reasons: signalReasons(signals), exitReason: 'signal' }
    : { action: 'hold', reasons: [] };
}

export function evaluateBacktestBar(
  klines: StockKLine[], index: number, position: BacktestPositionState,
  options: BacktestStrategyOptions = DEFAULT_TECHNICAL_STRATEGY_CONFIG,
): BacktestBarDecision {
  return evaluateConfiguredBacktestBar(klines, index, position, {
    ...DEFAULT_TECHNICAL_STRATEGY_CONFIG,
    stopLossPct: options.stopLossPct,
    maxHoldingDays: options.maxHoldingDays,
  });
}