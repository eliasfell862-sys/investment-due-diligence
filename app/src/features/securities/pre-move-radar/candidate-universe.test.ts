import { describe, expect, it } from 'vitest';
import type { AStockDirectoryItem, StockQuote } from '../../../infrastructure/market-data/stock-api';
import { buildPreMoveCandidateUniverse, selectStrengtheningIndustries } from './candidate-universe';

function stock(code: string, industry: string, name = `股票${code}`): AStockDirectoryItem {
  return { code, name, industry, classificationStatus: 'official' };
}
function quote(code: string, amount = 10000): StockQuote {
  return { code, name: `股票${code}`, market: code.startsWith('6') ? 'sh' : 'sz', price: 10,
    change: 0.2, changePct: 2, open: 9.8, high: 10.2, low: 9.7, volume: 1000,
    amount, preClose: 9.8, turnover: 2, pe: 10, pb: 1, totalShares: 0, floatShares: 0,
    totalCap: 100, floatCap: 80 };
}
const industries = [
  { industry: '银行', rank: 1, returnPercentile: 90, flowPercentile: 90, breadthPercentile: 80, relativeStrengthSlopePercentile: 80 },
  { industry: '新能源', rank: 2, returnPercentile: 85, flowPercentile: 80, breadthPercentile: 75, relativeStrengthSlopePercentile: 75 },
];

describe('pre-move candidate universe', () => {
  it('always includes every watchlist code outside strengthening industries', () => {
    const result = buildPreMoveCandidateUniverse({ watchlistCodes: ['000001'],
      directory: [stock('000001', '食品'), stock('000002', '银行')],
      quotes: [quote('000001'), quote('000002')], industries,
      capitalFlows: [{ code: '000002', changePct3d: 1, changePct5d: 2, changePct10d: 3,
        mainNet3d: 10, mainRatio3d: 1, mainNet5d: 20, mainRatio5d: 2, mainNet10d: 30, mainRatio10d: 3 }] });
    expect(result.find(item => item.code === '000001')?.source).toBe('watchlist');
  });

  it('uses only official directory industries selected by the top screen', () => {
    const result = buildPreMoveCandidateUniverse({ watchlistCodes: [],
      directory: [stock('000002', '银行'), { ...stock('000003', '银行'), classificationStatus: 'inferred' }],
      quotes: [quote('000002'), quote('000003')], industries, capitalFlows: [] });
    expect(result.map(item => item.code)).toEqual(['000002']);
  });

  it('deduplicates overlap and caps rotation-only candidates at two hundred', () => {
    const directory = Array.from({ length: 240 }, (_, index) => stock(String(index + 1).padStart(6, '0'), '银行'));
    const result = buildPreMoveCandidateUniverse({ watchlistCodes: ['000001'], directory,
      quotes: directory.map(item => quote(item.code)), industries, capitalFlows: [], maxRotationCandidates: 200 });
    expect(new Set(result.map(item => item.code)).size).toBe(result.length);
    expect(result.find(item => item.code === '000001')?.source).toBe('watchlist_and_rotation');
    expect(result.filter(item => item.source !== 'watchlist').length).toBeLessThanOrEqual(200);
  });

  it('selects at most ten industries with composite percentile at least sixty', () => {
    expect(selectStrengtheningIndustries([...industries,
      { industry: '弱行业', rank: 3, returnPercentile: 20, flowPercentile: 20, breadthPercentile: 20, relativeStrengthSlopePercentile: 20 }]))
      .toEqual(['银行', '新能源']);
  });
});