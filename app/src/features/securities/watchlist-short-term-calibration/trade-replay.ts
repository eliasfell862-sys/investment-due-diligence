import Decimal from 'decimal.js';
import type { CalibrationHistoryRow } from '../../../infrastructure/market-data/watchlist-calibration-history';
import { calculateActualTradeFees } from '../t-trading/trading-fee-engine';
import type { TradingFeeProfile } from '../t-trading/t-trading-types';
import type { CalibrationReplayResult, CalibrationSignal, CalibrationTrade } from './types';

export interface ReplayCalibrationSignalInput {
  signal: CalibrationSignal;
  futureRows: CalibrationHistoryRow[];
  feeProfile: TradingFeeProfile;
}

interface EntryFill {
  row: CalibrationHistoryRow;
  futureIndex: number;
  price: number;
}

function untradeable(row: CalibrationHistoryRow): boolean {
  if (!(row.volume > 0)) return true;
  return row.high === row.low && Math.abs(row.changePct) >= 9.5;
}

function findEntryFill(signal: CalibrationSignal, rows: CalibrationHistoryRow[]): EntryFill | null {
  for (let futureIndex = 0; futureIndex < Math.min(3, rows.length); futureIndex += 1) {
    const row = rows[futureIndex];
    if (untradeable(row)) continue;
    const { low, high } = signal.entryRange;
    if (row.open >= low && row.open <= high) return { row, futureIndex, price: row.open };
    if (row.open > high && row.low <= high) return { row, futureIndex, price: high };
    if (row.open < low && row.high >= low) return { row, futureIndex, price: low };
  }
  return null;
}

function money(value: Decimal.Value): number {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

function finalizeTrade(
  input: ReplayCalibrationSignalInput,
  fill: EntryFill,
  exitRow: CalibrationHistoryRow,
  exitPrice: number,
  exitReason: CalibrationTrade['exitReason'],
  secondTakeProfitReached: boolean,
): CalibrationTrade {
  const shares = 100 as const;
  const buyFees = calculateActualTradeFees({
    side: 'buy', price: fill.price, shares, profile: input.feeProfile,
  });
  const sellFees = calculateActualTradeFees({
    side: 'sell', price: exitPrice, shares, profile: input.feeProfile,
  });
  const grossPnl = money(new Decimal(exitPrice).minus(fill.price).times(shares));
  const netPnl = money(new Decimal(grossPnl).minus(buyFees.total).minus(sellFees.total));
  const invested = new Decimal(fill.price).times(shares).plus(buyFees.total);
  const netReturnPct = invested.gt(0)
    ? new Decimal(netPnl).dividedBy(invested).times(100).toDecimalPlaces(4).toNumber()
    : 0;
  return {
    kind: 'trade', code: input.signal.code, action: input.signal.action,
    signalDate: input.signal.signalDate, entryDate: fill.row.date, entryPrice: fill.price,
    exitDate: exitRow.date, exitPrice, shares, exitReason, secondTakeProfitReached,
    buyFees, sellFees, grossPnl, netPnl, netReturnPct, won: netPnl > 0,
  };
}

export function replayCalibrationSignal(input: ReplayCalibrationSignalInput): CalibrationReplayResult {
  const fill = findEntryFill(input.signal, input.futureRows.slice(0, 3));
  if (!fill) {
    if (input.futureRows.length < 3) {
      return { kind: 'incomplete', reason: 'insufficient_entry_history' };
    }
    return {
      kind: 'unfilled', code: input.signal.code,
      signalDate: input.signal.signalDate, action: input.signal.action,
    };
  }

  const exitRows = input.futureRows.slice(
    fill.futureIndex + 1,
    fill.futureIndex + 1 + input.signal.maxHoldingTradingDays,
  );
  for (let index = 0; index < exitRows.length; index += 1) {
    const row = exitRows[index];
    if (row.open <= input.signal.stopLoss) {
      return finalizeTrade(input, fill, row, row.open, 'stop_loss', false);
    }
    if (row.low <= input.signal.stopLoss) {
      return finalizeTrade(input, fill, row, input.signal.stopLoss, 'stop_loss', false);
    }
    if (row.open >= input.signal.takeProfit1 || row.high >= input.signal.takeProfit1) {
      const exitPrice = row.open >= input.signal.takeProfit1 ? row.open : input.signal.takeProfit1;
      const secondTakeProfitReached = exitRows
        .slice(index)
        .some(candidate => candidate.high >= input.signal.takeProfit2);
      return finalizeTrade(input, fill, row, exitPrice, 'take_profit_1', secondTakeProfitReached);
    }
  }

  if (exitRows.length < input.signal.maxHoldingTradingDays) {
    return { kind: 'incomplete', reason: 'insufficient_exit_history' };
  }
  const finalRow = exitRows[exitRows.length - 1];
  return finalizeTrade(input, fill, finalRow, finalRow.close, 'max_holding', false);
}

