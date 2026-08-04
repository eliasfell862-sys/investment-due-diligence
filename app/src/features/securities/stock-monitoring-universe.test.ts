import { describe, expect, it } from 'vitest';
import { STOCK_POSITION_LEDGER_KEY } from './stock-position-ledger';
import { loadMonitoringUniverse } from './stock-monitoring-universe';

const WATCHLISTS_KEY = 'sec_watchlists_v2';

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key: string) { return values.get(key) ?? null; },
  };
}

function ledgerWithPositions(codes: string[]) {
  return JSON.stringify({
    version: 1,
    groups: [{ id: 'default', name: '默认持仓' }],
    positions: codes.map((code, index) => ({
      id: `position-${index}`,
      groupId: 'default',
      code,
      name: code,
      shares: 100,
      averageCost: 10,
      totalCost: 1_000,
      openedAt: '2026-08-04T01:30:00.000Z',
      updatedAt: '2026-08-04T01:30:00.000Z',
      sourceAlertIds: [`buy-${index}`],
    })),
    transactions: [],
  });
}

describe('loadMonitoringUniverse', () => {
  it('merges every watchlist with held stocks and returns stable unique code sets', () => {
    const storage = memoryStorage({
      [WATCHLISTS_KEY]: JSON.stringify([
        { id: 'wl-1', name: '价值', codes: ['600519', '000001', '600519'] },
        { id: 'wl-2', name: '成长', codes: ['000001', '300750'] },
      ]),
      [STOCK_POSITION_LEDGER_KEY]: ledgerWithPositions(['000001', '002594']),
    });

    expect(loadMonitoringUniverse(storage)).toEqual({
      buyCodes: ['000001', '300750', '600519'],
      heldCodes: ['000001', '002594'],
      allCodes: ['000001', '002594', '300750', '600519'],
    });
  });

  it('keeps held stocks monitored when watchlist JSON is damaged', () => {
    const storage = memoryStorage({
      [WATCHLISTS_KEY]: '{broken',
      [STOCK_POSITION_LEDGER_KEY]: ledgerWithPositions(['300750']),
    });

    expect(loadMonitoringUniverse(storage)).toEqual({
      buyCodes: [],
      heldCodes: ['300750'],
      allCodes: ['300750'],
    });
  });

  it('returns empty arrays when there are no watchlists or positions', () => {
    expect(loadMonitoringUniverse(memoryStorage())).toEqual({
      buyCodes: [],
      heldCodes: [],
      allCodes: [],
    });
  });

  it('ignores malformed watchlist entries and blank codes', () => {
    const storage = memoryStorage({
      [WATCHLISTS_KEY]: JSON.stringify([
        null,
        { id: 'wl-1', codes: [' 000001 ', '', 123, '000001'] },
        { id: 'wl-2', codes: 'not-an-array' },
      ]),
    });

    expect(loadMonitoringUniverse(storage).buyCodes).toEqual(['000001']);
  });
});
