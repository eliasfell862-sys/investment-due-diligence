export type SignalCycleAction = 'buy' | 'sell' | 'hold';
export type SignalCycleIntent = 'open' | 'add' | 'reduce' | 'exit';
export type SignalCycleTransitionKind = 'opened' | 'continued' | 'closed' | 'reversed';

export interface SignalCycleState {
  code: string;
  strategyId: string;
  strategyVersion: string;
  buyDirection: 'buy' | 'hold';
  sellDirection: 'sell' | 'hold';
  buyCycleId: string | null;
  sellCycleId: string | null;
  updatedAt: string | null;
}

export interface SignalCycleDecision {
  code: string;
  strategyId: string;
  strategyVersion: string;
  action: SignalCycleAction;
  intent: SignalCycleIntent | null;
  signalAt: string;
}

export interface SignalCycleTransition {
  kind: SignalCycleTransitionKind;
  state: SignalCycleState;
  cycleId: string | null;
}

export function emptySignalCycleState(
  code: string,
  strategyId: string,
  strategyVersion: string,
): SignalCycleState {
  return {
    code,
    strategyId,
    strategyVersion,
    buyDirection: 'hold',
    sellDirection: 'hold',
    buyCycleId: null,
    sellCycleId: null,
    updatedAt: null,
  };
}

function makeCycleId(decision: SignalCycleDecision): string {
  return [
    decision.code,
    decision.strategyId,
    decision.strategyVersion,
    decision.action,
    decision.intent ?? 'none',
    decision.signalAt,
  ].map(value => encodeURIComponent(value)).join(':');
}

function assertMatchingIdentity(state: SignalCycleState, decision: SignalCycleDecision): void {
  if (state.code !== decision.code
    || state.strategyId !== decision.strategyId
    || state.strategyVersion !== decision.strategyVersion) {
    throw new Error('Signal cycle state identity does not match decision');
  }
}

export function transitionSignalCycle(
  state: SignalCycleState,
  decision: SignalCycleDecision,
): SignalCycleTransition {
  assertMatchingIdentity(state, decision);
  const hadBuy = state.buyDirection === 'buy';
  const hadSell = state.sellDirection === 'sell';

  if (decision.action === 'hold') {
    return {
      kind: hadBuy || hadSell ? 'closed' : 'continued',
      cycleId: null,
      state: {
        ...state,
        buyDirection: 'hold',
        sellDirection: 'hold',
        buyCycleId: null,
        sellCycleId: null,
        updatedAt: decision.signalAt,
      },
    };
  }

  const isBuy = decision.action === 'buy';
  const sameDirection = isBuy ? hadBuy : hadSell;
  const oppositeDirection = isBuy ? hadSell : hadBuy;
  const existingCycleId = isBuy ? state.buyCycleId : state.sellCycleId;
  const cycleId = sameDirection && existingCycleId
    ? existingCycleId
    : makeCycleId(decision);

  return {
    kind: sameDirection ? 'continued' : oppositeDirection ? 'reversed' : 'opened',
    cycleId,
    state: {
      ...state,
      strategyVersion: decision.strategyVersion,
      buyDirection: isBuy ? 'buy' : 'hold',
      sellDirection: isBuy ? 'hold' : 'sell',
      buyCycleId: isBuy ? cycleId : null,
      sellCycleId: isBuy ? null : cycleId,
      updatedAt: decision.signalAt,
    },
  };
}
