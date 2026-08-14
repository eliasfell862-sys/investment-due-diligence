import type { TradeFeeBreakdown } from '../t-trading/t-trading-types';

export const WATCHLIST_SHORT_TERM_CALIBRATION_MODEL = 'watchlist-short-term-v1';
export type CalibrationBuyAction = 'strong_buy' | 'buy_on_dip';

export interface CalibrationSignal {
  code: string;
  signalDate: string;
  action: CalibrationBuyAction;
  entryRange: { low: number; high: number };
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  maxHoldingTradingDays: number;
}

export interface CalibrationTrade {
  kind: 'trade';
  code: string;
  action: CalibrationBuyAction;
  signalDate: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  shares: 100;
  exitReason: 'stop_loss' | 'take_profit_1' | 'max_holding';
  secondTakeProfitReached: boolean;
  buyFees: TradeFeeBreakdown;
  sellFees: TradeFeeBreakdown;
  grossPnl: number;
  netPnl: number;
  netReturnPct: number;
  won: boolean;
}

export interface CalibrationUnfilledSignal {
  kind: 'unfilled';
  code: string;
  signalDate: string;
  action: CalibrationBuyAction;
}

export type CalibrationReplayResult = CalibrationTrade | CalibrationUnfilledSignal | {
  kind: 'incomplete';
  reason: 'insufficient_entry_history' | 'insufficient_exit_history';
};

