import { describe, expect, it } from 'vitest';
import type { StockPositionLedger } from '../stock-position-ledger';
import { buildSecuritiesMonitoringUniverse } from './securities-monitoring-universe';

function ledger(codes: string[]): StockPositionLedger {
  return {
    version: 1,
    groups: [],
    transactions: [],
    positions: codes.map((code, index) => ({
      id: `position-${index}`,
      groupId: 'default',
      code,
      name: code,
      shares: 100,
      averageCost: 10,
      totalCost: 1_000,
      openedAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z',
      sourceAlertIds: [],
    })),
  };
}

describe('buildSecuritiesMonitoringUniverse', () => {
  it('builds a sorted unique union from watchlists and actual holdings', () => {
    expect(buildSecuritiesMonitoringUniverse(
      [{ codes: [' 600519 ', '000001', '', '000001'] }, { codes: ['300750'] }],
      ledger(['600519', '601899', '   ']),
    )).toEqual({
      buyCodes: ['000001', '300750', '600519'],
      heldCodes: ['600519', '601899'],
      allCodes: ['000001', '300750', '600519', '601899'],
    });
  });

  it('keeps actual holdings monitored when watchlists are empty', () => {
    expect(buildSecuritiesMonitoringUniverse([], ledger(['000001']))).toEqual({
      buyCodes: [],
      heldCodes: ['000001'],
      allCodes: ['000001'],
    });
  });
});