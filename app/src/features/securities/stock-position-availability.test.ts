import { describe, expect, it } from 'vitest';
import type { StockPositionLedger, StockTransaction } from './stock-position-ledger';
import { calculateStockPositionAvailability } from './stock-position-availability';

interface LedgerFixture {
  shares: number;
  buys?: Array<[string, number]>;
  sells?: Array<[string, number]>;
}

function transaction(
  type: 'buy' | 'sell',
  tradedAt: string,
  shares: number,
  index: number,
): StockTransaction {
  return {
    id: `${type}-${index}`,
    groupId: 'default',
    code: '000001',
    name: '平安银行',
    type,
    shares,
    price: 10,
    amount: shares * 10,
    tradedAt,
    sourceAlertId: `${type}-alert-${index}`,
    realizedProfit: 0,
  };
}

function ledger({ shares, buys = [], sells = [] }: LedgerFixture): StockPositionLedger {
  const transactions = [
    ...buys.map(([tradedAt, quantity], index) => transaction('buy', tradedAt, quantity, index)),
    ...sells.map(([tradedAt, quantity], index) => transaction('sell', tradedAt, quantity, index)),
  ];
  return {
    version: 1,
    groups: [{ id: 'default', name: '默认持仓' }],
    positions: [{
      id: 'position-1', groupId: 'default', code: '000001', name: '平安银行',
      shares, averageCost: 10, totalCost: shares * 10,
      openedAt: '2025-01-02T01:30:00.000Z', updatedAt: '2026-08-05T01:30:00.000Z',
      sourceAlertIds: transactions.map(item => item.sourceAlertId),
    }],
    transactions,
  };
}

describe('stock position availability', () => {
  it('returns zero quantities for a missing position', () => {
    const input = ledger({ shares: 100 });
    expect(calculateStockPositionAvailability(input, '600519', '2026-08-05T06:00:00.000Z'))
      .toEqual({ totalShares: 0, availableShares: 0, frozenShares: 0, nextAvailableDate: null });
  });

  it('freezes a same-day first buy', () => {
    expect(calculateStockPositionAvailability(
      ledger({ shares: 100, buys: [['2026-08-05T01:30:00.000Z', 100]] }),
      '000001', '2026-08-05T06:00:00.000Z',
    )).toEqual({
      totalShares: 100, availableShares: 0, frozenShares: 100,
      nextAvailableDate: '2026-08-06',
    });
  });

  it('unlocks the buy on the next trading day', () => {
    expect(calculateStockPositionAvailability(
      ledger({ shares: 100, buys: [['2026-08-05T01:30:00.000Z', 100]] }),
      '000001', '2026-08-06T01:30:00.000Z',
    ).availableShares).toBe(100);
  });

  it('keeps historical baseline shares available while freezing a same-day add', () => {
    expect(calculateStockPositionAvailability(
      ledger({ shares: 500, buys: [['2026-08-05T01:30:00.000Z', 200]] }),
      '000001', '2026-08-05T06:00:00.000Z',
    )).toMatchObject({ totalShares: 500, availableShares: 300, frozenShares: 200 });
  });

  it('reduces available shares after a same-day sale without unlocking the add', () => {
    expect(calculateStockPositionAvailability(
      ledger({
        shares: 400,
        buys: [['2026-08-05T01:30:00.000Z', 200]],
        sells: [['2026-08-05T03:00:00.000Z', 100]],
      }),
      '000001', '2026-08-05T06:00:00.000Z',
    )).toMatchObject({ totalShares: 400, availableShares: 200, frozenShares: 200 });
  });

  it('keeps a pre-holiday buy frozen until the first post-holiday session', () => {
    const input = ledger({ shares: 100, buys: [['2026-09-30T01:30:00.000Z', 100]] });
    expect(calculateStockPositionAvailability(input, '000001', '2026-10-07T06:00:00.000Z'))
      .toMatchObject({ availableShares: 0, nextAvailableDate: '2026-10-08' });
    expect(calculateStockPositionAvailability(input, '000001', '2026-10-08T01:30:00.000Z'))
      .toMatchObject({ availableShares: 100, frozenShares: 0 });
  });

  it('treats an unexplained historical position as fully available', () => {
    expect(calculateStockPositionAvailability(
      ledger({ shares: 500, buys: [] }), '000001', '2026-08-05T06:00:00.000Z',
    )).toEqual({
      totalShares: 500, availableShares: 500, frozenShares: 0, nextAvailableDate: null,
    });
  });

  it('treats pre-coverage buy transactions as already unlocked history', () => {
    expect(calculateStockPositionAvailability(
      ledger({ shares: 100, buys: [['2024-12-31T01:30:00.000Z', 100]] }),
      '000001', '2026-08-05T06:00:00.000Z',
    ).availableShares).toBe(100);
  });
});
