import type { MediumTermAdviceAction } from '../../../engines/market-analysis/medium-term-buy-advice';
import type { ShortTermAdviceAction } from '../../../engines/market-analysis/short-term-trading-advice';

export const LIVE_SIGNAL_PRIORITY = [
  'hard_stop',
  'fatal_exit',
  'take_profit_2',
  'take_profit_1',
  't_buyback',
  't_sell',
  'hold',
] as const;

export type LiveTradingSignalKind =
  | 'core_buy'
  | 'observe_buy'
  | 'hard_stop'
  | 'fatal_exit'
  | 'take_profit_2'
  | 'take_profit_1'
  | 'loss_wait'
  | 't_buyback'
  | 't_sell'
  | 'hold';

export interface LiveTradingSignalInput {
  price: number;
  dataFresh: boolean;
  shortAction: ShortTermAdviceAction;
  mediumAction: MediumTermAdviceAction;
  shortEntryRange: { low: number; high: number } | null;
  formalBuyPrice: number | null;
  formalSellPrice: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  totalShares: number;
  availableShares: number;
  unrealizedProfit: number;
  hardStopTriggered: boolean;
  fatalRisk: boolean;
  tSellEligible: boolean;
  tBuybackEligible: boolean;
}

export interface LiveTradingSignalDecision {
  kind: LiveTradingSignalKind;
  requiresSell: boolean;
  requiresUserConfirmation: boolean;
  suggestedShares: number;
  reasons: string[];
}

const shortBuyActions = new Set<ShortTermAdviceAction>(['strong_buy', 'buy_on_dip']);
const mediumBuyActions = new Set<MediumTermAdviceAction>(['accumulate', 'cautious_buy', 'watch']);
const shortWeakActions = new Set<ShortTermAdviceAction>(['avoid', 'reduce_sell']);
const mediumWeakActions = new Set<MediumTermAdviceAction>(['avoid_buying', 'risk_avoidance']);

function decision(
  kind: LiveTradingSignalKind,
  options: Partial<Omit<LiveTradingSignalDecision, 'kind'>> = {},
): LiveTradingSignalDecision {
  return {
    kind,
    requiresSell: false,
    requiresUserConfirmation: false,
    suggestedShares: 0,
    reasons: [],
    ...options,
  };
}

function firstTakeProfitShares(totalShares: number, availableShares: number): number {
  if (availableShares <= 0 || totalShares <= 0) return 0;
  if (totalShares <= 100) return Math.min(totalShares, availableShares);
  const half = Math.floor((totalShares * 0.5) / 100) * 100;
  return Math.min(Math.max(100, half), availableShares);
}

function evaluatePosition(input: LiveTradingSignalInput): LiveTradingSignalDecision {
  const available = Math.max(0, Math.min(input.totalShares, input.availableShares));
  if (input.hardStopTriggered) {
    return decision('hard_stop', {
      requiresSell: true,
      requiresUserConfirmation: false,
      suggestedShares: available,
      reasons: [available > 0 ? '硬止损已触发' : '硬止损已触发但受T+1可用数量约束'],
    });
  }
  if (input.fatalRisk) {
    return decision('fatal_exit', {
      requiresSell: true,
      requiresUserConfirmation: true,
      suggestedShares: available,
      reasons: ['致命风险优先于盈亏和普通策略信号'],
    });
  }

  const shortWeak = shortWeakActions.has(input.shortAction);
  const mediumWeak = mediumWeakActions.has(input.mediumAction);
  const profitable = input.unrealizedProfit > 0;
  const secondTargetReached = input.takeProfit2 !== null && input.price >= input.takeProfit2;
  if (profitable && (secondTargetReached || (shortWeak && mediumWeak))) {
    return decision('take_profit_2', {
      requiresSell: true,
      requiresUserConfirmation: true,
      suggestedShares: available,
      reasons: [secondTargetReached ? '达到第二止盈价' : '短中线评级同时转弱且当前盈利'],
    });
  }

  const firstTargetReached = input.takeProfit1 !== null && input.price >= input.takeProfit1;
  const formalSellReached = input.formalSellPrice !== null && input.price >= input.formalSellPrice;
  if (profitable && (firstTargetReached || formalSellReached || shortWeak || mediumWeak)) {
    return decision('take_profit_1', {
      requiresSell: true,
      requiresUserConfirmation: true,
      suggestedShares: firstTakeProfitShares(input.totalShares, available),
      reasons: [
        firstTargetReached
          ? '达到第一止盈价'
          : formalSellReached
            ? '达到个股分析正式建议卖出价'
            : '评级转弱且当前盈利，按第一止盈规则处理',
      ],
    });
  }

  if (input.unrealizedProfit < 0 && (shortWeak || mediumWeak)) {
    return decision('loss_wait', {
      reasons: ['评级转弱但当前亏损，保持硬止损并进入亏损观察'],
    });
  }
  if (input.tBuybackEligible) {
    return decision('t_buyback', {
      requiresUserConfirmation: true,
      reasons: ['做T回补必须由用户确认'],
    });
  }
  if (input.tSellEligible) {
    return decision('t_sell', {
      requiresSell: true,
      requiresUserConfirmation: true,
      reasons: ['做T卖出必须由用户确认'],
    });
  }
  return decision('hold', { reasons: ['未触发更高优先级交易条件'] });
}

function evaluateEntry(input: LiveTradingSignalInput): LiveTradingSignalDecision {
  const adviceEligible = input.dataFresh
    && shortBuyActions.has(input.shortAction)
    && mediumBuyActions.has(input.mediumAction);
  if (!adviceEligible || !Number.isFinite(input.price) || input.price <= 0) {
    return decision('hold', { reasons: ['短中线评级或数据新鲜度不满足买入门槛'] });
  }
  if (input.formalBuyPrice !== null && input.price <= input.formalBuyPrice) {
    return decision('core_buy', {
      reasons: ['达到个股分析正式建议买入价'],
    });
  }
  if (
    input.shortEntryRange
    && input.price >= input.shortEntryRange.low
    && input.price <= input.shortEntryRange.high
  ) {
    return decision('observe_buy', {
      reasons: ['进入短线建议买入区间，继续观察正式买点'],
    });
  }
  return decision('hold', { reasons: ['价格尚未进入短线区间或正式买点'] });
}

export function evaluateLiveTradingSignal(
  input: LiveTradingSignalInput,
): LiveTradingSignalDecision {
  return input.totalShares > 0 ? evaluatePosition(input) : evaluateEntry(input);
}
