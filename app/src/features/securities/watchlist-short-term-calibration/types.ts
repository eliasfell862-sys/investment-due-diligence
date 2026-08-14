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

export type CalibrationTrust = 'insufficient' | 'preliminary' | 'established' | 'blocked';

export interface CalibrationMetrics {
  signalCount: number;
  completedTrades: number;
  fillRate: number;
  winRate: number;
  averageNetReturnPct: number;
  maxDrawdownPct: number;
  profitFactor: number | null;
  firstTakeProfitRate: number;
  secondTakeProfitPathRate: number;
  stopLossRate: number;
  maxHoldingExitRate: number;
  unfilledRate: number;
}

export interface CalibrationValidStock {
  code: string;
  turnoverMode: 'direct' | 'proxy';
}

export interface CalibrationSkippedStock {
  code: string;
  reason: string;
}

export interface AggregateCalibrationInput {
  trades: CalibrationTrade[];
  unfilled: CalibrationUnfilledSignal[];
  totalStocks: number;
  validStocks: CalibrationValidStock[];
  skippedStocks: CalibrationSkippedStock[];
  dataAsOf: string;
  leakageBlocked: boolean;
  createdAt: string;
}

export interface WatchlistShortTermCalibrationResult {
  modelVersion: typeof WATCHLIST_SHORT_TERM_CALIBRATION_MODEL;
  createdAt: string;
  dataAsOf: string;
  trust: CalibrationTrust;
  coverageRate: number;
  validStockCount: number;
  skippedStockCount: number;
  directStockCount: number;
  proxyStockCount: number;
  directStockRate: number;
  overall: CalibrationMetrics;
  byAction: Record<CalibrationBuyAction, CalibrationMetrics>;
  skippedStocks: CalibrationSkippedStock[];
  trades: CalibrationTrade[];
  unfilled: CalibrationUnfilledSignal[];
  warnings: string[];
  persistenceWarning?: string;
}

export type CalibrationMetricSelection =
  | { scope: 'not_applicable'; metrics: null }
  | { scope: 'action_group' | 'overall_fallback'; metrics: CalibrationMetrics };

