import { describe, expect, it } from 'vitest';
import {
  buyVirtualPosition,
  calculateVirtualAvailability,
  createEmptyVirtualTradingLedger,
  sellVirtualPosition,
  type BuyVirtualPositionInput,
  type SellVirtualPositionInput,
  type VirtualLedgerOptions,
  type VirtualTradingLedger,
} from './virtual-trading-ledger';

let idSequence = 0;

function ids(): VirtualLedgerOptions {
  return { createId: kind => `${kind}-${++idSequence}` };
}

function buyInput(overrides: Partial<BuyVirtualPositionInput> = {}): BuyVirtualPositionInput {
  return {
    sourceSignalId: 'signal-buy-1',
    strategyId: 'realtime-technical',
    strategyVersion: '1',
    code: '000001',
    name: '平安银行',
    shares: 100,
    price: 10,
    tradedAt: '2026-08-06T02:00:00.000Z',
    reasons: ['测试买入'],
    ...overrides,
  };
}

function sellInput(overrides: Partial<SellVirtualPositionInput> = {}): SellVirtualPositionInput {
  return {
    ...buyInput(),
    sourceSignalId: 'signal-sell-1',
    tradedAt: '2026-08-07T02:00:00.000Z',
    reasons: ['测试卖出'],
    ...overrides,
  };
}

function openedLedger(shares = 100, price = 10, tradedAt = '2026-08-06T02:00:00.000Z') {
  return buyVirtualPosition(
    createEmptyVirtualTradingLedger(),
    buyInput({ shares, price, tradedAt }),
    ids(),
  );
}

describe('virtual trading ledger', () => {
  it('opens 100 shares and creates one open cycle', () => {
    const result = openedLedger(100, 1500);

    expect(result.position).toMatchObject({ shares: 100, averageCost: 1500, totalCost: 150000 });
    expect(result.transaction).toMatchObject({ type: 'buy', intent: 'open', positionSharesAfter: 100 });
    expect(result.cycle).toMatchObject({ status: 'open', buyAmount: 150000 });
    expect(result.ledger.positions).toHaveLength(1);
  });

  it('adds 100 shares and recalculates weighted average cost', () => {
    const opened = openedLedger();
    const result = buyVirtualPosition(opened.ledger, buyInput({
      sourceSignalId: 'signal-buy-2',
      price: 14,
      tradedAt: '2026-08-07T02:00:00.000Z',
    }), ids());

    expect(result.position).toMatchObject({ shares: 200, averageCost: 12, totalCost: 2400 });
    expect(result.transaction.intent).toBe('add');
    expect(result.cycle.buyAmount).toBe(2400);
  });

  it('rejects duplicate source signal ids', () => {
    const opened = openedLedger();
    expect(() => buyVirtualPosition(opened.ledger, buyInput(), ids()))
      .toThrow('该虚拟信号已经成交');
  });

  it.each([
    [{ price: 0 }, '成交价格必须大于0'],
    [{ shares: 0 }, '成交股数必须为正整数'],
    [{ shares: 50 }, '买入股数必须为100股的整数倍'],
  ])('rejects invalid buy input %o', (overrides, message) => {
    expect(() => buyVirtualPosition(createEmptyVirtualTradingLedger(), buyInput(overrides), ids()))
      .toThrow(message);
  });

  it('freezes same-day buys until the next A-share trading day', () => {
    const opened = openedLedger();

    expect(calculateVirtualAvailability(opened.ledger, '000001', 'realtime-technical', '2026-08-06'))
      .toEqual({
        totalShares: 100,
        availableShares: 0,
        frozenShares: 100,
        nextAvailableDate: '2026-08-07',
      });
  });

  it('keeps Friday buys frozen until Monday', () => {
    const opened = openedLedger(100, 10, '2026-08-07T02:00:00.000Z');

    expect(calculateVirtualAvailability(opened.ledger, '000001', 'realtime-technical', '2026-08-10'))
      .toMatchObject({ availableShares: 100, nextAvailableDate: null });
  });

  it('records a partial sell without closing the cycle', () => {
    const opened = openedLedger(400, 10, '2026-08-05T02:00:00.000Z');
    const result = sellVirtualPosition(opened.ledger, sellInput({ shares: 100, price: 12 }), ids());

    expect(result.position).toMatchObject({ shares: 300, averageCost: 10, totalCost: 3000 });
    expect(result.transaction).toMatchObject({ intent: 'reduce', realizedProfit: 200 });
    expect(result.cycle).toMatchObject({ status: 'open', realizedProfit: 200, returnPct: null });
  });

  it('closes the cycle when remaining shares reach zero', () => {
    const opened = openedLedger(100, 10, '2026-08-05T02:00:00.000Z');
    const result = sellVirtualPosition(opened.ledger, sellInput({ shares: 100, price: 12 }), ids());

    expect(result.position).toBeNull();
    expect(result.transaction.intent).toBe('exit');
    expect(result.cycle).toMatchObject({ status: 'closed', realizedProfit: 200, returnPct: 20 });
  });

  it('rejects selling more than the T+1 available shares', () => {
    const opened = openedLedger();
    expect(() => sellVirtualPosition(opened.ledger, sellInput({
      tradedAt: '2026-08-06T03:00:00.000Z',
    }), ids()))
      .toThrow('卖出股数超过可用虚拟持仓');
  });

  it('does not mutate the input ledger', () => {
    const ledger: VirtualTradingLedger = createEmptyVirtualTradingLedger();
    buyVirtualPosition(ledger, buyInput(), ids());
    expect(ledger).toEqual({ version: 1, positions: [], transactions: [], cycles: [] });
  });
});
