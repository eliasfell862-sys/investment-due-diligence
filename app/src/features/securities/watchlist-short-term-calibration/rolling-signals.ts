import { scanPatterns, type PatternResult } from '../../../engines/market-analysis/kline-patterns';
import {
  buildShortTermTradingAdvice,
  type ShortTermAdviceBaseInput,
  type ShortTermIndicatorKLine,
  type ShortTermTradingAdvice,
} from '../../../engines/market-analysis/short-term-trading-advice';
import { calcAllIndicators } from '../../../engines/market-analysis/technical-indicators';
import { scanStrategies, type StrategySignal } from '../../../engines/market-analysis/trading-strategies';
import type { CalibrationHistoryRow } from '../../../infrastructure/market-data/watchlist-calibration-history';
import type { StockQuote } from '../../../infrastructure/market-data/stock-api';
import type { CalibrationSignal } from './types';

export interface RollingCalibrationDependencies {
  calcIndicators: (rows: ShortTermIndicatorKLine[]) => void;
  scanStrategies: (rows: ShortTermIndicatorKLine[]) => StrategySignal[];
  scanPatterns: (rows: ShortTermIndicatorKLine[]) => PatternResult[];
  buildAdvice: (input: ShortTermAdviceBaseInput) => ShortTermTradingAdvice;
}

function defaults(): RollingCalibrationDependencies {
  return {
    calcIndicators: rows => { calcAllIndicators(rows); },
    scanStrategies,
    scanPatterns,
    buildAdvice: buildShortTermTradingAdvice,
  };
}

function historicalQuote(
  code: string,
  previous: CalibrationHistoryRow,
  current: CalibrationHistoryRow,
): StockQuote {
  return {
    code, name: code, market: code.startsWith('6') ? 'sh' : 'sz',
    price: current.close, change: current.change, changePct: current.changePct,
    open: current.open, high: current.high, low: current.low,
    volume: current.volume, amount: current.amount, preClose: previous.close,
    turnover: current.turnover ?? 0, pe: 0, pb: 0, totalShares: 0,
    floatShares: 0, totalCap: 0, floatCap: 0,
  };
}

function completeBuyPlan(advice: ShortTermTradingAdvice): boolean {
  return (advice.action === 'strong_buy' || advice.action === 'buy_on_dip')
    && advice.entryRange !== null
    && advice.stopLoss !== null
    && advice.takeProfit1 !== null
    && advice.takeProfit2 !== null
    && advice.maxHoldingTradingDays !== null
    && [advice.entryRange.low, advice.entryRange.high, advice.stopLoss,
      advice.takeProfit1, advice.takeProfit2, advice.maxHoldingTradingDays]
      .every(Number.isFinite);
}

export function generateRollingCalibrationSignals(
  code: string,
  rows: CalibrationHistoryRow[],
  overrides: Partial<RollingCalibrationDependencies> = {},
): CalibrationSignal[] {
  const dependencies = { ...defaults(), ...overrides };
  const signals: CalibrationSignal[] = [];
  for (let index = 60; index < rows.length; index += 1) {
    const visible = rows.slice(0, index + 1).map(row => ({ ...row })) as ShortTermIndicatorKLine[];
    dependencies.calcIndicators(visible);
    const advice = dependencies.buildAdvice({
      quote: historicalQuote(code, rows[index - 1], rows[index]),
      klines: visible,
      strategies: dependencies.scanStrategies(visible),
      patterns: dependencies.scanPatterns(visible),
      dataAsOf: rows[index].date,
      calculatedAt: rows[index].date + 'T15:00:00+08:00',
      cacheStatus: 'fresh',
    });
    if (!completeBuyPlan(advice)) continue;
    signals.push({
      code,
      signalDate: rows[index].date,
      action: advice.action as 'strong_buy' | 'buy_on_dip',
      entryRange: { ...advice.entryRange! },
      stopLoss: advice.stopLoss!,
      takeProfit1: advice.takeProfit1!,
      takeProfit2: advice.takeProfit2!,
      maxHoldingTradingDays: advice.maxHoldingTradingDays!,
    });
  }
  return signals;
}

