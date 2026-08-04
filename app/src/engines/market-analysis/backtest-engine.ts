/**
 * Backtesting Engine — TypeScript port of InStock's backtesting framework.
 * Simulates trades based on technical signals and computes performance metrics.
 */

import type { StockKLine } from '../../infrastructure/market-data/stock-api';
import { evaluateBacktestBar } from './backtest-strategy';

export interface BacktestTrade {
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  returnPct: number;
  direction: 'long';
  exitReason: 'signal' | 'stop_loss' | 'timeout';
  holdingDays: number;
}

export interface BacktestResult {
  symbol: string;
  period: string;           // 回测区间 e.g. "2024-01-01 ~ 2026-08-01"
  totalTrades: number;
  winRate: number;          // 胜率%
  totalReturn: number;      // 总收益%
  annualReturn: number;     // 年化收益%
  maxDrawdown: number;      // 最大回撤%
  sharpeRatio: number;      // 夏普比率
  avgHoldingDays: number;   // 平均持仓天数
  profitFactor: number;     // 盈亏比
  benchmarkReturn: number;  // 基准收益(买入持有)%
  excessReturn: number;     // 超额收益%
  trades: BacktestTrade[];
  equityCurve: { date: string; value: number }[];
}

// ── Main Backtest ──

export function runBacktest(
  klines: StockKLine[],
  capital: number = 100000,
  stopLossPct: number = 8,
  maxHoldingDays: number = 60,
): BacktestResult {
  if (klines.length < 60) {
    return {
      symbol: '', period: '', totalTrades: 0, winRate: 0, totalReturn: 0,
      annualReturn: 0, maxDrawdown: 0, sharpeRatio: 0, avgHoldingDays: 0,
      profitFactor: 0, benchmarkReturn: 0, excessReturn: 0, trades: [], equityCurve: [],
    };
  }

  // Simulate trades
  const trades: BacktestTrade[] = [];
  const equityCurve: { date: string; value: number }[] = [{ date: klines[0].date, value: capital }];
  let cash = capital;
  let inPosition = false;
  let entryPrice = 0;
  let entryDate = '';
  let entryIndex = 0;

  for (let i = 20; i < klines.length; i++) {
    const price = klines[i].close;
    const date = klines[i].date;

    const decision = evaluateBacktestBar(
      klines,
      i,
      inPosition
        ? { inPosition: true, entryPrice, entryIndex }
        : { inPosition: false },
      { stopLossPct, maxHoldingDays },
    );

    if (!inPosition) {
      if (decision.action === 'buy') {
        inPosition = true;
        entryPrice = price;
        entryDate = date;
        entryIndex = i;
      }
    } else if (decision.action === 'sell') {
      const pnl = (price - entryPrice) / entryPrice * 100;
      const daysHeld = i - entryIndex;
      trades.push({
        entryDate, exitDate: date, entryPrice, exitPrice: price,
        returnPct: Math.round(pnl * 100) / 100,
        direction: 'long',
        exitReason: decision.exitReason ?? 'signal',
        holdingDays: daysHeld,
      });
      cash = cash * (1 + pnl / 100);
      equityCurve.push({ date, value: Math.round(cash * 100) / 100 });
      inPosition = false;
    }
  }

  // Benchmark: buy and hold
  const benchmarkReturn = Math.round((klines[klines.length - 1].close / klines[20].close - 1) * 10000) / 100;

  // Compute metrics
  const totalTrades = trades.length;
  const wins = trades.filter(t => t.returnPct > 0).length;
  const winRate = totalTrades > 0 ? Math.round(wins / totalTrades * 100) : 0;
  const totalReturn = Math.round((cash / capital - 1) * 10000) / 100;
  const years = (klines.length - 20) / 250;
  const annualReturn = years > 0 ? Math.round(((Math.pow(cash / capital, 1 / years) - 1) * 100) * 100) / 100 : 0;
  const excessReturn = Math.round((totalReturn - benchmarkReturn) * 100) / 100;

  // Max drawdown
  let peak = capital;
  let maxDD = 0;
  for (const t of trades) {
    const val = capital * (1 + t.returnPct / 100);
    if (val > peak) peak = val;
    const dd = (peak - val) / peak * 100;
    if (dd > maxDD) maxDD = dd;
  }
  const maxDrawdown = Math.round(maxDD * 100) / 100;

  // Sharpe ratio
  const returns = trades.map(t => t.returnPct / 100);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdDev = returns.length > 1
    ? Math.sqrt(returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1))
    : 0.01;
  const sharpeRatio = stdDev > 0 ? Math.round((avgReturn / stdDev * Math.sqrt(250)) * 100) / 100 : 0;

  // Avg holding days
  const avgHoldingDays = totalTrades > 0
    ? Math.round(trades.reduce((s, t) => s + t.holdingDays, 0) / totalTrades * 10) / 10
    : 0;

  // Profit factor
  const totalWin = trades.filter(t => t.returnPct > 0).reduce((s, t) => s + t.returnPct, 0);
  const totalLoss = Math.abs(trades.filter(t => t.returnPct <= 0).reduce((s, t) => s + t.returnPct, 0));
  const profitFactor = totalLoss > 0 ? Math.round(totalWin / totalLoss * 100) / 100 : 0;

  return {
    symbol: '',
    period: `${klines[20].date} ~ ${klines[klines.length - 1].date}`,
    totalTrades, winRate, totalReturn, annualReturn, maxDrawdown, sharpeRatio,
    avgHoldingDays, profitFactor, benchmarkReturn, excessReturn,
    trades,
    equityCurve: equityCurve.length > 1 ? equityCurve : [
      { date: klines[0].date, value: capital },
      { date: klines[klines.length - 1].date, value: Math.round(capital * (1 + benchmarkReturn / 100) * 100) / 100 },
    ],
  };
}
