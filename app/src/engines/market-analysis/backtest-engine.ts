/**
 * Shared A-share backtesting engine.
 * Signals are generated after a bar closes and filled at the next tradable open.
 */
import type { StockKLine } from '../../infrastructure/market-data/stock-api';
import { evaluateBacktestBar } from './backtest-strategy';

export interface BacktestExecutionModel {
  fillTiming: 'next_open';
  lotSize: number;
  tPlusOne: boolean;
  commissionRate: number;
  minimumCommission: number;
  sellStampDutyRate: number;
  slippageRate: number;
}

export interface BacktestTrade {
  signalEntryDate: string;
  entryDate: string;
  signalExitDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  grossReturnPct: number;
  netReturnPct: number;
  returnPct: number;
  totalFees: number;
  direction: 'long';
  exitReason: 'signal' | 'stop_loss' | 'timeout';
  holdingDays: number;
}

export interface BacktestResult {
  symbol: string;
  period: string;
  totalTrades: number;
  winRate: number;
  totalReturn: number;
  annualReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  avgHoldingDays: number;
  profitFactor: number;
  benchmarkReturn: number;
  excessReturn: number;
  totalFees?: number;
  executionModel?: BacktestExecutionModel;
  trades: BacktestTrade[];
  equityCurve: { date: string; value: number }[];
}

const DEFAULT_EXECUTION_MODEL: BacktestExecutionModel = {
  fillTiming: 'next_open',
  lotSize: 100,
  tPlusOne: true,
  commissionRate: 0.0003,
  minimumCommission: 5,
  sellStampDutyRate: 0.0005,
  slippageRate: 0.001,
};

interface OpenPosition {
  shares: number;
  entryPrice: number;
  entryIndex: number;
  entryDate: string;
  signalEntryDate: string;
  buyCommission: number;
  costBasis: number;
}

type PendingOrder =
  | { side: 'buy'; signalDate: string }
  | { side: 'sell'; signalDate: string; exitReason: 'signal' | 'stop_loss' | 'timeout' };

const round2 = (value: number) => Math.round(value * 100) / 100;
const commission = (amount: number, model: BacktestExecutionModel) =>
  amount > 0 ? Math.max(model.minimumCommission, amount * model.commissionRate) : 0;

function emptyResult(model: BacktestExecutionModel): BacktestResult {
  return {
    symbol: '', period: '', totalTrades: 0, winRate: 0, totalReturn: 0,
    annualReturn: 0, maxDrawdown: 0, sharpeRatio: 0, avgHoldingDays: 0,
    profitFactor: 0, benchmarkReturn: 0, excessReturn: 0, totalFees: 0,
    executionModel: model, trades: [], equityCurve: [],
  };
}

function calculateMaxDrawdown(curve: Array<{ value: number }>) {
  let peak = 0;
  let maximum = 0;
  for (const point of curve) {
    peak = Math.max(peak, point.value);
    if (peak > 0) maximum = Math.max(maximum, (peak - point.value) / peak * 100);
  }
  return round2(maximum);
}

function calculateDailySharpe(curve: Array<{ value: number }>) {
  const returns: number[] = [];
  for (let index = 1; index < curve.length; index += 1) {
    const previous = curve[index - 1].value;
    if (previous > 0) returns.push(curve[index].value / previous - 1);
  }
  if (returns.length < 2) return 0;
  const average = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / (returns.length - 1);
  const deviation = Math.sqrt(variance);
  return deviation > 0 ? round2(average / deviation * Math.sqrt(250)) : 0;
}

export function runBacktest(
  klines: StockKLine[],
  capital = 100000,
  stopLossPct = 8,
  maxHoldingDays = 60,
  executionOverrides: Partial<BacktestExecutionModel> = {},
): BacktestResult {
  const model = { ...DEFAULT_EXECUTION_MODEL, ...executionOverrides };
  if (klines.length < 60 || capital <= 0) return emptyResult(model);

  const trades: BacktestTrade[] = [];
  const equityCurve: { date: string; value: number }[] = [];
  let cash = capital;
  let position: OpenPosition | null = null;
  let pending: PendingOrder | null = null;
  let totalFees = 0;

  for (let index = 20; index < klines.length; index += 1) {
    const bar = klines[index];
    const tradable = Number.isFinite(bar.open) && bar.open > 0 && bar.volume > 0;

    if (pending && tradable) {
      if (pending.side === 'buy' && !position) {
        const fillPrice = bar.open * (1 + model.slippageRate);
        let shares = Math.floor(cash / fillPrice / model.lotSize) * model.lotSize;
        let amount = shares * fillPrice;
        let buyCommission = commission(amount, model);
        while (shares > 0 && amount + buyCommission > cash) {
          shares -= model.lotSize;
          amount = shares * fillPrice;
          buyCommission = commission(amount, model);
        }
        if (shares > 0) {
          cash -= amount + buyCommission;
          totalFees += buyCommission;
          position = {
            shares, entryPrice: fillPrice, entryIndex: index, entryDate: bar.date,
            signalEntryDate: pending.signalDate, buyCommission,
            costBasis: amount + buyCommission,
          };
        }
        pending = null;
      } else if (pending.side === 'sell' && position) {
        const fillPrice = bar.open * (1 - model.slippageRate);
        const grossProceeds = position.shares * fillPrice;
        const sellCommission = commission(grossProceeds, model);
        const stampDuty = grossProceeds * model.sellStampDutyRate;
        const netProceeds = grossProceeds - sellCommission - stampDuty;
        const grossReturnPct = (fillPrice / position.entryPrice - 1) * 100;
        const netReturnPct = (netProceeds / position.costBasis - 1) * 100;
        const fees = position.buyCommission + sellCommission + stampDuty;
        cash += netProceeds;
        totalFees += sellCommission + stampDuty;
        trades.push({
          signalEntryDate: position.signalEntryDate,
          entryDate: position.entryDate,
          signalExitDate: pending.signalDate,
          exitDate: bar.date,
          entryPrice: round2(position.entryPrice),
          exitPrice: round2(fillPrice),
          shares: position.shares,
          grossReturnPct: round2(grossReturnPct),
          netReturnPct: round2(netReturnPct),
          returnPct: round2(netReturnPct),
          totalFees: round2(fees),
          direction: 'long',
          exitReason: pending.exitReason,
          holdingDays: index - position.entryIndex,
        });
        position = null;
        pending = null;
      }
    }

    if (!pending) {
      const decision = evaluateBacktestBar(
        klines,
        index,
        position
          ? { inPosition: true, entryPrice: position.entryPrice, entryIndex: position.entryIndex }
          : { inPosition: false },
        { stopLossPct, maxHoldingDays },
      );
      if (!position && decision.action === 'buy' && index + 1 < klines.length) {
        pending = { side: 'buy', signalDate: bar.date };
      } else if (position && decision.action === 'sell' && index + 1 < klines.length) {
        pending = { side: 'sell', signalDate: bar.date, exitReason: decision.exitReason ?? 'signal' };
      }
    }

    const markedValue = cash + (position ? position.shares * bar.close : 0);
    equityCurve.push({ date: bar.date, value: round2(markedValue) });
  }

  const finalValue = equityCurve.at(-1)?.value ?? capital;
  const totalReturn = round2((finalValue / capital - 1) * 100);
  const years = equityCurve.length / 250;
  const annualReturn = years > 0 && finalValue > 0
    ? round2((Math.pow(finalValue / capital, 1 / years) - 1) * 100)
    : 0;
  const benchmarkReturn = round2((klines.at(-1)!.close / klines[20].close - 1) * 100);
  const wins = trades.filter(trade => trade.netReturnPct > 0);
  const losses = trades.filter(trade => trade.netReturnPct <= 0);
  const totalWin = wins.reduce((sum, trade) => sum + trade.netReturnPct, 0);
  const totalLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netReturnPct, 0));

  return {
    symbol: '',
    period: `${klines[20].date} ~ ${klines.at(-1)!.date}`,
    totalTrades: trades.length,
    winRate: trades.length ? round2(wins.length / trades.length * 100) : 0,
    totalReturn,
    annualReturn,
    maxDrawdown: calculateMaxDrawdown(equityCurve),
    sharpeRatio: calculateDailySharpe(equityCurve),
    avgHoldingDays: trades.length
      ? round2(trades.reduce((sum, trade) => sum + trade.holdingDays, 0) / trades.length)
      : 0,
    profitFactor: totalLoss > 0 ? round2(totalWin / totalLoss) : totalWin > 0 ? Number.POSITIVE_INFINITY : 0,
    benchmarkReturn,
    excessReturn: round2(totalReturn - benchmarkReturn),
    totalFees: round2(totalFees),
    executionModel: model,
    trades,
    equityCurve,
  };
}
