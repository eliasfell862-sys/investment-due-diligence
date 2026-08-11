import Decimal from 'decimal.js';
import type {
  OpenTTradeCycleInput,
  TTradeCycle,
  TTradeExecution,
} from './t-trading-types';

function money(value: Decimal.Value): number {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

function precise(value: Decimal.Value): number {
  return new Decimal(value).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toNumber();
}

function validateBoardLot(shares: number, field: string): void {
  if (!Number.isInteger(shares) || shares <= 0 || shares % 100 !== 0) {
    throw new Error(`${field} shares must be a positive 100-share board lot`);
  }
}

function validateExecution(execution: TTradeExecution, expectedSide: TTradeExecution['side']): void {
  if (execution.side !== expectedSide) throw new Error(`execution side must be ${expectedSide}`);
  validateBoardLot(execution.shares, expectedSide);
  if (!Number.isFinite(execution.price) || execution.price <= 0) {
    throw new Error('execution price must be positive');
  }
  if (!Number.isFinite(execution.totalFees) || execution.totalFees < 0) {
    throw new Error('execution fees must be non-negative');
  }
  if (!execution.id || !execution.idempotencyKey || !execution.executedAt) {
    throw new Error('execution identity and timestamp are required');
  }
}

function cloneExecution(execution: TTradeExecution): TTradeExecution {
  return { ...execution };
}

function cloneCycle(cycle: TTradeCycle): TTradeCycle {
  return {
    ...cycle,
    riskReviewReasons: [...cycle.riskReviewReasons],
    executions: cycle.executions.map(cloneExecution),
  };
}

function sellExecution(cycle: TTradeCycle): TTradeExecution {
  const execution = cycle.executions.find((candidate) => candidate.side === 'sell');
  if (!execution) throw new Error('cycle sell execution is missing');
  return execution;
}

function realizedProfit(cycle: TTradeCycle, executions: TTradeExecution[]): number {
  const sell = sellExecution(cycle);
  return money(executions
    .filter((execution) => execution.side === 'buyback')
    .reduce((total, buyback) => {
      const allocatedSellFees = new Decimal(sell.totalFees)
        .times(buyback.shares)
        .dividedBy(cycle.soldShares);
      const matchedProfit = new Decimal(sell.price)
        .minus(buyback.price)
        .times(buyback.shares)
        .minus(allocatedSellFees)
        .minus(buyback.totalFees);
      return total.plus(matchedProfit);
    }, new Decimal(0)));
}

function assertTransitionAllowed(cycle: TTradeCycle): void {
  if (['completed', 'kept_as_reduction', 'cancelled_by_user'].includes(cycle.status)) {
    throw new Error(`cycle status ${cycle.status} cannot accept a buyback`);
  }
}

export function openTTradeCycle(input: OpenTTradeCycleInput): TTradeCycle {
  validateExecution(input.sellExecution, 'sell');
  if (!Number.isFinite(input.preCycleAverageCost) || input.preCycleAverageCost < 0) {
    throw new Error('pre-cycle average cost must be non-negative');
  }
  validateBoardLot(input.preCycleTotalShares, 'pre-cycle total');
  if (input.sellExecution.shares > input.preCycleTotalShares) {
    throw new Error('sell shares exceed pre-cycle total shares');
  }
  return {
    id: input.id,
    positionId: input.positionId,
    code: input.code,
    cycleType: input.cycleType,
    status: 'buyback_monitoring',
    preCycleAverageCost: input.preCycleAverageCost,
    preCycleTotalShares: input.preCycleTotalShares,
    soldShares: input.sellExecution.shares,
    remainingBuybackShares: input.sellExecution.shares,
    keptAsReductionShares: 0,
    realizedTProfit: 0,
    costReductionPerShare: 0,
    adjustedAverageCost: input.preCycleAverageCost,
    monitoringEnabled: true,
    riskReviewReasons: [],
    executions: [cloneExecution(input.sellExecution)],
  };
}

export function applyTTradeBuyback(
  inputCycle: TTradeCycle,
  buybackExecution: TTradeExecution,
): TTradeCycle {
  assertTransitionAllowed(inputCycle);
  validateExecution(buybackExecution, 'buyback');
  if (inputCycle.executions.some((execution) => (
    execution.idempotencyKey === buybackExecution.idempotencyKey
  ))) {
    throw new Error('duplicate idempotency key');
  }
  if (buybackExecution.shares > inputCycle.remainingBuybackShares) {
    throw new Error('buyback shares exceed remaining shares');
  }

  const executions = [
    ...inputCycle.executions.map(cloneExecution),
    cloneExecution(buybackExecution),
  ];
  const remainingBuybackShares = inputCycle.remainingBuybackShares - buybackExecution.shares;
  const profit = realizedProfit(inputCycle, executions);
  const completed = remainingBuybackShares === 0;
  const costReductionPerShare = completed
    ? precise(new Decimal(profit).dividedBy(inputCycle.preCycleTotalShares))
    : 0;

  return {
    ...cloneCycle(inputCycle),
    status: completed ? 'completed' : 'partially_bought_back',
    remainingBuybackShares,
    realizedTProfit: profit,
    costReductionPerShare,
    adjustedAverageCost: completed
      ? precise(new Decimal(inputCycle.preCycleAverageCost).minus(costReductionPerShare))
      : inputCycle.preCycleAverageCost,
    monitoringEnabled: !completed,
    executions,
  };
}

export function pauseTTradeBuyback(
  inputCycle: TTradeCycle,
  reasons: string[],
): TTradeCycle {
  assertTransitionAllowed(inputCycle);
  return {
    ...cloneCycle(inputCycle),
    status: 'buyback_paused_risk_review',
    monitoringEnabled: false,
    riskReviewReasons: [...reasons],
  };
}

export function expireTTradeCycle(inputCycle: TTradeCycle): TTradeCycle {
  assertTransitionAllowed(inputCycle);
  return {
    ...cloneCycle(inputCycle),
    status: 'expired_unfilled',
    monitoringEnabled: false,
  };
}

export function keepTTradeAsReduction(inputCycle: TTradeCycle): TTradeCycle {
  assertTransitionAllowed(inputCycle);
  return {
    ...cloneCycle(inputCycle),
    status: 'kept_as_reduction',
    keptAsReductionShares: inputCycle.remainingBuybackShares,
    monitoringEnabled: false,
  };
}
