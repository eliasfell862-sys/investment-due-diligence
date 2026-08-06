import { describe, expect, it } from 'vitest';
import {
  parseBenchmarkKlineResponse,
  parseHistoricalCapitalFlowResponse,
  parseIndustryFlowResponse,
  parseMultiDayCapitalFlowResponse,
} from './pre-move-market-data-api';

describe('pre-move market data parsers', () => {
  it('parses industry one five and ten day fields', () => {
    const rows = parseIndustryFlowResponse({ data: { diff: [{
      f12: 'BK0475', f14: '银行', f3: 1.2, f62: 120000000, f184: 3.1,
      f164: 450000000, f165: 4.6, f174: 700000000, f175: 5.2, f204: '600000',
    }] } });
    expect(rows[0]).toEqual({
      industryCode: 'BK0475', industryName: '银行', changePct1d: 1.2,
      mainNet1d: 120000000, mainRatio1d: 3.1, mainNet5d: 450000000,
      mainRatio5d: 4.6, mainNet10d: 700000000, mainRatio10d: 5.2,
      leadingStockCode: '600000',
    });
  });

  it('preserves unavailable provider fields as null', () => {
    const row = parseIndustryFlowResponse({ data: { diff: [{ f12: 'BK1', f14: '测试' }] } })[0];
    expect(row.mainRatio10d).toBeNull();
    expect(row.changePct1d).toBe(0);
  });

  it('parses period-specific individual capital flow fields', () => {
    const row = parseMultiDayCapitalFlowResponse({ data: { diff: [{
      f12: '000001', f127: 1.1, f267: 300, f268: 2.1,
      f109: 2.2, f164: 500, f165: 3.2,
      f160: 4.4, f174: 800, f175: 5.3,
    }] } }, 10)[0];
    expect(row).toMatchObject({ code: '000001', changePct3d: 1.1, mainNet3d: 300,
      changePct5d: 2.2, mainNet5d: 500, changePct10d: 4.4, mainNet10d: 800 });
  });

  it('parses benchmark K lines and historical daily capital flow', () => {
    const benchmark = parseBenchmarkKlineResponse({ data: { klines: ['2026-08-05,10,10.5,10.8,9.9,1000,2000'] } });
    const flow = parseHistoricalCapitalFlowResponse({ data: { klines: ['2026-08-05,1.5,2.5,100,80'] } });
    expect(benchmark[0]).toMatchObject({ date: '2026-08-05', open: 10, close: 10.5, amount: 2000 });
    expect(flow[0]).toEqual({ date: '2026-08-05', mainNet: 100, mainRatio: 1.5, superLargeNet: 80, largeNet: 2.5 });
  });
});