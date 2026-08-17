import type { MediumTermBuyAdvice } from '../../../engines/market-analysis/medium-term-buy-advice';
import type { ShortTermTradingAdvice } from '../../../engines/market-analysis/short-term-trading-advice';
import type { TradingFeeProfile } from '../t-trading/t-trading-types';

export type LiveTradingMode = 'shadow' | 'read_only_probe';
export type LiveTradeSide = 'buy' | 'sell';
export type LiveTradeIntentKind =
  | 'core_buy'
  | 'take_profit_1'
  | 'take_profit_2'
  | 'hard_stop'
  | 'fatal_exit'
  | 't_sell'
  | 't_buyback';

export type ShadowOrderStatus =
  | 'eligible'
  | 'preauthorized'
  | 'awaiting_user_confirmation'
  | 'submitting'
  | 'submitted'
  | 'partially_filled'
  | 'filled'
  | 'cancelled'
  | 'rejected'
  | 'expired'
  | 'blocked_by_risk';

export interface LiveTradingProfile {
  mode: LiveTradingMode;
  capitalPool: number;
  maximumInvested: number;
  reservedCash: number;
  maximumPositions: number;
  maximumPerStock: number;
  maximumPlannedLoss: number;
  dailyCircuitBreaker: number;
  boardLot: 100;
  maximumTTradeAvailableRatio: 0.35;
  orderTtlSeconds: 30;
}

export interface LiveTradingFormalTargets {
  buyPrice: number;
  sellPrice: number;
  stopLoss: number;
  supportLevel: number;
  resistanceLevel: number;
  atr: number;
}

export interface LiveTradingCandidate {
  code: string;
  name: string;
  price: number;
  shortAdvice: ShortTermTradingAdvice;
  mediumAdvice: MediumTermBuyAdvice;
  formalTargets: LiveTradingFormalTargets;
  combinedScore: number;
  dataFresh: boolean;
  dataAsOf: string;
  failureReasons: string[];
}

export interface BrokerPositionSnapshot {
  code: string;
  name: string;
  totalShares: number;
  availableShares: number;
  averageCost: number;
  marketPrice: number;
  marketValue: number;
}

export interface BrokerAccountSnapshot {
  availableCash: number;
  totalAssets: number;
  positions: BrokerPositionSnapshot[];
  realizedProfitToday: number;
  paidFeesToday: number;
  capturedAt: string;
}

export interface LiveTradeIntent {
  id: string;
  idempotencyKey: string;
  kind: LiveTradeIntentKind;
  code: string;
  name: string;
  side: LiveTradeSide;
  limitPrice: number;
  shares: number;
  stopPrice: number | null;
  createdAt: string;
  expiresAt: string;
  requiresUserConfirmation: boolean;
  feeProfile: TradingFeeProfile;
  reasons: string[];
}

export interface ShadowOrder extends LiveTradeIntent {
  status: ShadowOrderStatus;
  submittedAt: string | null;
  filledShares: number;
  averageFillPrice: number | null;
  brokerOrderId: null;
  failureKind: string | null;
}

export interface ShadowFill {
  id: string;
  orderId: string;
  code: string;
  side: LiveTradeSide;
  price: number;
  shares: number;
  fees: number;
  filledAt: string;
}

export interface BridgeCapabilityReport {
  processDetected: boolean;
  windowDetected: boolean;
  loginStateReadable: boolean;
  fundsViewReadable: boolean;
  positionsViewReadable: boolean;
  ordersViewReadable: boolean;
  cancelControlReadable: boolean;
  safeForShadow: boolean;
  safeForLive: false;
  productVersion: string | null;
  executablePathHash: string | null;
  unknownDialogs: string[];
  evidence: string[];
  probedAt: string;
}
