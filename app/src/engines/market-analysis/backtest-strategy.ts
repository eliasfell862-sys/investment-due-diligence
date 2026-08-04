import type { StockKLine } from '../../infrastructure/market-data/stock-api';

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

const DEFAULT_OPTIONS: BacktestStrategyOptions = {
  stopLossPct: 8,
  maxHoldingDays: 60,
};

export function evaluateBacktestBar(
  klines: StockKLine[],
  index: number,
  position: BacktestPositionState,
  options: BacktestStrategyOptions = DEFAULT_OPTIONS,
): BacktestBarDecision {
  if (index <= 0 || index >= klines.length) return { action: 'hold', reasons: [] };

  const current = klines[index] as StockKLine & Record<string, any>;
  const previous = klines[index - 1] as StockKLine & Record<string, any>;

  if (!position.inPosition) {
    if (
      current.macd
      && previous.macd
      && previous.macd.dif <= previous.macd.dea
      && current.macd.dif > current.macd.dea
    ) {
      return { action: 'buy', reasons: ['MACD金叉'] };
    }
    if (current.kdj?.j < 20) return { action: 'buy', reasons: ['KDJ超卖'] };
    if (current.rsi?.rsi6 < 30) return { action: 'buy', reasons: ['RSI超卖'] };
    if (current.boll && current.close <= current.boll.lower * 1.01) {
      return { action: 'buy', reasons: ['触及布林下轨'] };
    }
    if (
      current.ma
      && previous.ma
      && previous.close <= previous.ma.ma20
      && current.close > current.ma.ma20
    ) {
      return { action: 'buy', reasons: ['突破MA20'] };
    }
    return { action: 'hold', reasons: [] };
  }

  const entryPrice = position.entryPrice ?? current.close;
  const entryIndex = position.entryIndex ?? index;
  const returnPct = entryPrice > 0 ? (current.close - entryPrice) / entryPrice * 100 : 0;

  if (returnPct <= -options.stopLossPct) {
    return { action: 'sell', reasons: ['止损'], exitReason: 'stop_loss' };
  }
  if (index - entryIndex >= options.maxHoldingDays) {
    return { action: 'sell', reasons: ['最长持仓期'], exitReason: 'timeout' };
  }
  if (
    current.macd
    && previous.macd
    && previous.macd.dif >= previous.macd.dea
    && current.macd.dif < current.macd.dea
  ) {
    return { action: 'sell', reasons: ['MACD死叉'], exitReason: 'signal' };
  }
  if (current.kdj?.j > 85) {
    return { action: 'sell', reasons: ['KDJ超买'], exitReason: 'signal' };
  }

  return { action: 'hold', reasons: [] };
}
