import { describe, expect, it } from 'vitest';
import {
  STOCK_POSITION_LEDGER_KEY,
  buyStockPosition,
  findStockPosition,
  loadStockLedger,
  sellStockPosition,
  type StockPositionLedgerOptions,
} from './stock-position-ledger';

function memoryStorage(seed?: string) {
  const values = new Map<string, string>();
  if (seed !== undefined) values.set(STOCK_POSITION_LEDGER_KEY, seed);
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    raw() { return values.get(STOCK_POSITION_LEDGER_KEY) ?? null; },
  };
}

function options(storage = memoryStorage()): StockPositionLedgerOptions & { storage: ReturnType<typeof memoryStorage> } {
  let sequence = 0;
  return {
    storage,
    createId: kind => `${kind}-${++sequence}`,
  };
}

describe('stock position ledger', () => {
  it('creates the default group, position, and transaction on first buy', () => {
    const dependencies = options();
    const result = buyStockPosition({
      code: '000001', name: '平安银行', shares: 100, price: 10,
      groupId: 'default', groupName: '默认持仓', sourceAlertId: 'buy-1',
      tradedAt: '2026-08-04T01:30:00.000Z',
    }, dependencies);

    expect(result.position).toMatchObject({
      code: '000001', shares: 100, averageCost: 10, totalCost: 1_000,
      groupId: 'default', sourceAlertIds: ['buy-1'],
    });
    expect(result.ledger.groups).toEqual([{ id: 'default', name: '默认持仓' }]);
    expect(result.transaction).toMatchObject({
      type: 'buy', shares: 100, price: 10, amount: 1_000, sourceAlertId: 'buy-1',
    });
    expect(JSON.parse(dependencies.storage.raw() ?? '{}').positions).toHaveLength(1);
  });

  it('uses weighted average cost when adding to a position', () => {
    const dependencies = options();
    buyStockPosition({
      code: '000001', name: '平安银行', shares: 100, price: 10,
      groupId: 'default', groupName: '默认持仓', sourceAlertId: 'buy-1',
      tradedAt: '2026-08-04T01:30:00.000Z',
    }, dependencies);
    const result = buyStockPosition({
      code: '000001', name: '平安银行', shares: 100, price: 12,
      groupId: 'default', groupName: '默认持仓', sourceAlertId: 'buy-2',
      tradedAt: '2026-08-05T01:30:00.000Z',
    }, dependencies);

    expect(result.position).toMatchObject({
      shares: 200, averageCost: 11, totalCost: 2_200,
      sourceAlertIds: ['buy-1', 'buy-2'],
    });
  });

  it('creates a named group when the selected group does not exist', () => {
    const dependencies = options();
    const result = buyStockPosition({
      code: '600519', name: '贵州茅台', shares: 100, price: 1_500,
      groupId: 'long-term', groupName: '长期持仓', sourceAlertId: 'buy-3',
      tradedAt: '2026-08-04T01:30:00.000Z',
    }, dependencies);

    expect(result.ledger.groups).toContainEqual({ id: 'long-term', name: '长期持仓' });
    expect(result.position.groupId).toBe('long-term');
  });

  it('records realized profit for a partial sale and preserves unit cost', () => {
    const dependencies = options();
    buyStockPosition({
      code: '000001', name: '平安银行', shares: 100, price: 10,
      groupId: 'default', groupName: '默认持仓', sourceAlertId: 'buy-1',
      tradedAt: '2026-08-04T01:30:00.000Z',
    }, dependencies);
    const result = sellStockPosition({
      code: '000001', shares: 40, price: 12,
      sourceAlertId: 'sell-1', tradedAt: '2026-08-05T02:00:00.000Z',
    }, dependencies);

    expect(result.position).toMatchObject({ shares: 60, averageCost: 10, totalCost: 600 });
    expect(result.transaction).toMatchObject({
      type: 'sell', amount: 480, realizedProfit: 80, sourceAlertId: 'sell-1',
    });
  });

  it('removes a position after a full sale while retaining the transaction history', () => {
    const dependencies = options();
    buyStockPosition({
      code: '000001', name: '平安银行', shares: 100, price: 10,
      groupId: 'default', groupName: '默认持仓', sourceAlertId: 'buy-1',
      tradedAt: '2026-08-04T01:30:00.000Z',
    }, dependencies);
    const result = sellStockPosition({
      code: '000001', shares: 100, price: 9,
      sourceAlertId: 'sell-1', tradedAt: '2026-08-05T02:00:00.000Z',
    }, dependencies);

    expect(result.position).toBeNull();
    expect(findStockPosition(result.ledger, '000001')).toBeNull();
    expect(result.transaction.realizedProfit).toBe(-100);
    expect(result.ledger.transactions).toHaveLength(2);
  });

  it('rejects invalid quantities, overselling, and repeated alert execution without changing storage', () => {
    const dependencies = options();
    expect(() => buyStockPosition({
      code: '000001', name: '平安银行', shares: 50, price: 10,
      groupId: 'default', groupName: '默认持仓', sourceAlertId: 'buy-bad',
      tradedAt: '2026-08-04T01:30:00.000Z',
    }, dependencies)).toThrow('买入股数必须是100股的整数倍');

    buyStockPosition({
      code: '000001', name: '平安银行', shares: 100, price: 10,
      groupId: 'default', groupName: '默认持仓', sourceAlertId: 'buy-1',
      tradedAt: '2026-08-04T01:30:00.000Z',
    }, dependencies);
    const before = dependencies.storage.raw();

    expect(() => sellStockPosition({
      code: '000001', shares: 101, price: 12,
      sourceAlertId: 'sell-too-many', tradedAt: '2026-08-05T02:00:00.000Z',
    }, dependencies)).toThrow('卖出股数不能超过当前持仓');
    expect(() => buyStockPosition({
      code: '000001', name: '平安银行', shares: 100, price: 11,
      groupId: 'default', groupName: '默认持仓', sourceAlertId: 'buy-1',
      tradedAt: '2026-08-05T01:30:00.000Z',
    }, dependencies)).toThrow('该信号已经执行过交易');
    expect(dependencies.storage.raw()).toBe(before);
  });

  it('reports corrupted storage without overwriting it', () => {
    const storage = memoryStorage('{broken');
    const before = storage.raw();
    expect(() => loadStockLedger(storage)).toThrow('实际持仓数据损坏');
    expect(storage.raw()).toBe(before);
  });
});
