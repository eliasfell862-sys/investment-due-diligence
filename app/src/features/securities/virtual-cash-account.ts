import Decimal from 'decimal.js';

export const VIRTUAL_INITIAL_CAPITAL = 200_000;

export interface VirtualCashAccount {
  initialCapital: number;
  cashBalance: number;
  reservedCash: number;
  version: number;
  updatedAt: string;
}

export interface VirtualCashFlowInput {
  side: 'buy' | 'sell';
  grossAmount: number;
  feeAmount: number;
  occurredAt: string;
}

export interface VirtualCashFlowResult {
  account: VirtualCashAccount;
  cashDelta: number;
}

export interface VirtualCashSummary {
  initialCapital: number;
  cashBalance: number;
  reservedCash: number;
  availableCash: number;
  investedCost: number;
  utilizationPct: number;
}

export class VirtualCashError extends Error {
  readonly code: 'virtual_cash_insufficient' | 'virtual_cash_invalid';
  readonly requiredCash: number;
  readonly availableCash: number;

  constructor(
    code: 'virtual_cash_insufficient' | 'virtual_cash_invalid',
    requiredCash: number,
    availableCash: number,
  ) {
    super(code);
    this.name = 'VirtualCashError';
    this.code = code;
    this.requiredCash = requiredCash;
    this.availableCash = availableCash;
  }
}

function money(value: Decimal.Value): number {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

function assertCashFlow(account: VirtualCashAccount, input: VirtualCashFlowInput): void {
  const validAccount = Number.isFinite(account.cashBalance)
    && account.cashBalance >= 0
    && Number.isFinite(account.reservedCash)
    && account.reservedCash >= 0
    && account.reservedCash <= account.cashBalance;
  const validFlow = Number.isFinite(input.grossAmount)
    && input.grossAmount > 0
    && Number.isFinite(input.feeAmount)
    && input.feeAmount >= 0
    && Number.isFinite(Date.parse(input.occurredAt));
  if (!validAccount || !validFlow) {
    throw new VirtualCashError('virtual_cash_invalid', 0, money(account.cashBalance || 0));
  }
}

export function createVirtualCashAccount(updatedAt: string): VirtualCashAccount {
  if (!Number.isFinite(Date.parse(updatedAt))) {
    throw new VirtualCashError('virtual_cash_invalid', 0, VIRTUAL_INITIAL_CAPITAL);
  }
  return {
    initialCapital: VIRTUAL_INITIAL_CAPITAL,
    cashBalance: VIRTUAL_INITIAL_CAPITAL,
    reservedCash: 0,
    version: 0,
    updatedAt,
  };
}

export function applyVirtualCashFlow(
  account: VirtualCashAccount,
  input: VirtualCashFlowInput,
): VirtualCashFlowResult {
  assertCashFlow(account, input);
  const grossAmount = new Decimal(input.grossAmount);
  const feeAmount = new Decimal(input.feeAmount);
  const requiredCash = money(grossAmount.plus(feeAmount));
  const availableCash = money(new Decimal(account.cashBalance).minus(account.reservedCash));
  if (input.side === 'buy' && requiredCash > availableCash) {
    throw new VirtualCashError(
      'virtual_cash_insufficient',
      requiredCash,
      availableCash,
    );
  }

  const cashDelta = input.side === 'buy'
    ? grossAmount.plus(feeAmount).negated()
    : grossAmount.minus(feeAmount);
  const nextCash = new Decimal(account.cashBalance).plus(cashDelta);

  if (nextCash.isNegative()) {
    throw new VirtualCashError(
      'virtual_cash_insufficient',
      requiredCash,
      money(account.cashBalance),
    );
  }

  return {
    cashDelta: money(cashDelta),
    account: {
      ...account,
      cashBalance: money(nextCash),
      version: account.version + 1,
      updatedAt: input.occurredAt,
    },
  };
}

export function summarizeVirtualCash(
  account: VirtualCashAccount,
  investedCost: number,
): VirtualCashSummary {
  if (!Number.isFinite(investedCost) || investedCost < 0) {
    throw new VirtualCashError('virtual_cash_invalid', 0, account.cashBalance);
  }
  const availableCash = money(new Decimal(account.cashBalance).minus(account.reservedCash));
  return {
    initialCapital: account.initialCapital,
    cashBalance: account.cashBalance,
    reservedCash: account.reservedCash,
    availableCash,
    investedCost: money(investedCost),
    utilizationPct: account.initialCapital > 0
      ? money(new Decimal(investedCost).div(account.initialCapital).times(100))
      : 0,
  };
}
