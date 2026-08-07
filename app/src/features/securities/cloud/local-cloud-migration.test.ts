import { describe, expect, it } from 'vitest';
import { buildLocalMigration, LocalMigrationDataError } from './local-cloud-migration';

function storageWithFixture(positionShares = 300): Pick<Storage, 'getItem'> {
  const values: Record<string, string> = {
    sec_watchlists_v2: JSON.stringify([
      {
        id: 'wl-2', name: '成长', createdAt: '2026-08-02T00:00:00.000Z',
        codes: ['600519', '000001', '600519'], groups: [], codeGroups: {},
      },
      {
        id: 'wl-1', name: '核心', createdAt: '2026-08-01T00:00:00.000Z',
        codes: ['000001'], groups: [], codeGroups: {},
      },
    ]),
    sec_stock_position_ledger_v1: JSON.stringify({
      version: 1,
      groups: [{ id: 'core', name: '核心持仓' }],
      positions: [{
        id: 'position-1', groupId: 'core', code: '000001', name: '平安银行',
        shares: positionShares, averageCost: 11.33, totalCost: 3_400,
        openedAt: '2026-08-03T01:30:00.000Z', updatedAt: '2026-08-05T02:00:00.000Z',
        sourceAlertIds: ['alert-1', 'alert-2'],
      }],
      transactions: [
        {
          id: 'tx-1', groupId: 'core', code: '000001', name: '平安银行', type: 'buy',
          shares: 200, price: 10, amount: 2_000, tradedAt: '2026-08-03T01:30:00.000Z',
          sourceAlertId: 'alert-1', realizedProfit: 0,
        },
        {
          id: 'tx-2', groupId: 'core', code: '000001', name: '平安银行', type: 'buy',
          shares: 200, price: 12, amount: 2_400, tradedAt: '2026-08-04T01:30:00.000Z',
          sourceAlertId: 'alert-2', realizedProfit: 0,
        },
        {
          id: 'tx-3', groupId: 'core', code: '000001', name: '平安银行', type: 'sell',
          shares: 100, price: 15, amount: 1_500, tradedAt: '2026-08-05T02:00:00.000Z',
          sourceAlertId: 'alert-3', realizedProfit: 366.67,
        },
      ],
    }),
    sec_bt_signal_runtime_v3: JSON.stringify({
      version: 3,
      alerts: [],
      stocks: {
        '000001': {
          lastBuyDecision: 'buy', lastSellDecision: 'hold',
          updatedAt: '2026-08-05T02:00:00.000Z', blockedSellUntil: null,
          blockedSellNotifiedOn: null, pendingVirtualSell: null,
        },
      },
      virtualLedger: { version: 1, positions: [], transactions: [], cycles: [] },
    }),
  };
  return { getItem: key => values[key] ?? null };
}

describe('buildLocalMigration', () => {
  it('builds a deterministic migration id and normalized watchlist items', () => {
    const first = buildLocalMigration(storageWithFixture(), 'user-a');
    const second = buildLocalMigration(storageWithFixture(), 'user-a');

    expect(first.migrationId).toBe(second.migrationId);
    expect(first.migrationId).toMatch(/^[a-f0-9]{64}$/);
    expect([...new Set(first.watchlistItems.map(item => item.code))]).toEqual(['000001', '600519']);
    expect(first.positions[0]?.shares).toBe(300);
  });

  it('rebuilds remaining actual-position lots with FIFO sells', () => {
    const payload = buildLocalMigration(storageWithFixture(), 'user-a');

    expect(payload.positionLots).toEqual([
      expect.objectContaining({ sourceTransactionId: 'tx-1', shares: 200, remainingShares: 100 }),
      expect.objectContaining({ sourceTransactionId: 'tx-2', shares: 200, remainingShares: 200 }),
    ]);
  });

  it('rejects a ledger whose reconstructed lots do not match the holding total', () => {
    expect(() => buildLocalMigration(storageWithFixture(400), 'user-a'))
      .toThrow(LocalMigrationDataError);
  });
});
