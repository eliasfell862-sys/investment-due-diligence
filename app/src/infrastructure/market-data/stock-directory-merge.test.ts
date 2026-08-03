import { describe, expect, it } from 'vitest';
import { mergeStockDirectories } from './stock-api';

describe('mergeStockDirectories', () => {
  it('keeps the complete local directory when provider classifications are partial', () => {
    const local = [
      { code: '000001', name: '平安银行', industry: '未分类' },
      { code: '000002', name: '万科A', industry: '未分类' },
      { code: '600519', name: '贵州茅台', industry: '未分类' },
    ];
    const provider = [
      { code: '000001', name: '平安银行', industry: '银行' },
      { code: '600519', name: '贵州茅台', industry: '白酒' },
    ];

    const merged = mergeStockDirectories(local, provider);

    expect(merged).toHaveLength(3);
    expect(merged.find((stock) => stock.code === '000001')?.industry).toBe('银行');
    expect(merged.find((stock) => stock.code === '000002')?.industry).toBe('未分类');
  });

  it('also includes newly listed provider securities missing from the local snapshot', () => {
    const merged = mergeStockDirectories(
      [{ code: '000001', name: '平安银行', industry: '未分类' }],
      [{ code: '688999', name: '新上市公司', industry: '电子' }],
    );

    expect(merged.map((stock) => stock.code)).toEqual(['000001', '688999']);
  });
});
