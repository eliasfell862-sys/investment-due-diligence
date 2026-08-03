import { describe, expect, it } from 'vitest';
import { buildSecurityMaster } from './security-master';

describe('buildSecurityMaster', () => {
  it('creates stable identities and exchange/board fields for A-share securities', () => {
    const records = buildSecurityMaster([
      { code: '000001', name: '平安银行', industry: '银行' },
      { code: '300750', name: '宁德时代', industry: '电池' },
      { code: '600519', name: '贵州茅台', industry: '白酒' },
      { code: '688981', name: '中芯国际', industry: '半导体' },
      { code: '920001', name: '北交所公司', industry: '未分类' },
    ], {
      directorySource: 'baostock',
      classificationSource: 'eastmoney',
      asOf: '2026-08-03T00:00:00.000Z',
      classificationVersion: 'eastmoney-2026-08-03',
    });

    expect(records[0]).toMatchObject({
      securityId: 'CN.SZSE.000001', exchange: 'SZSE', board: 'main',
    });
    expect(records[1]).toMatchObject({ exchange: 'SZSE', board: 'chinext' });
    expect(records[2]).toMatchObject({ exchange: 'SSE', board: 'main' });
    expect(records[3]).toMatchObject({ exchange: 'SSE', board: 'star' });
    expect(records[4]).toMatchObject({ exchange: 'BSE', board: 'bse' });
  });

  it('records classification provenance and preserves unknown classifications explicitly', () => {
    const [record] = buildSecurityMaster(
      [{ code: '000002', name: '万科A', industry: '未分类' }],
      {
        directorySource: 'baostock',
        classificationSource: 'eastmoney',
        asOf: '2026-08-03T00:00:00.000Z',
        classificationVersion: 'eastmoney-2026-08-03',
      },
    );

    expect(record.industry).toBeNull();
    expect(record.classificationStatus).toBe('unclassified');
    expect(record.classificationStandard).toBeNull();
    expect(record.provenance).toEqual({
      directorySource: 'baostock',
      classificationSource: 'eastmoney',
      asOf: '2026-08-03T00:00:00.000Z',
      classificationVersion: 'eastmoney-2026-08-03',
    });
  });

  it('keeps official and inferred classifications as distinct evidence levels', () => {
    const [official] = buildSecurityMaster(
      [{ code: '600519', name: '贵州茅台', industry: '白酒' }],
      { directorySource: 'eastmoney', classificationSource: 'eastmoney', asOf: '2026-08-03', classificationVersion: 'eastmoney-2026-08-03' },
    );
    const [inferred] = buildSecurityMaster(
      [{ code: '000428', name: '华天酒店', industry: '白酒' }],
      { directorySource: 'baostock', classificationSource: 'heuristic', asOf: '2026-08-01', classificationVersion: 'heuristic-2026-08-01' },
    );

    expect(official).toMatchObject({ classificationStatus: 'official', classificationStandard: 'eastmoney' });
    expect(inferred).toMatchObject({ classificationStatus: 'inferred', classificationStandard: 'heuristic' });
  });
});
