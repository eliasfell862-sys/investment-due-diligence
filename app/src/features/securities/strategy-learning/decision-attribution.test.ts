import { describe, expect, it } from 'vitest';
import { attributeVirtualTransaction, type AttributionInput } from './decision-attribution';

const input = (overrides: Partial<AttributionInput> = {}): AttributionInput => ({
  decisionType: 'buy',
  reasons: ['RSI超卖'],
  decisionPrice: 10,
  closePrice: 10.1,
  atr: 0.3,
  rsi6: 26,
  availableShares: 0,
  existingReturnPct: 0,
  nextDayReturnPct: null,
  dataQualityBlockingIssues: [],
  ...overrides,
});

describe('attributeVirtualTransaction', () => {
  it('separates a sound process from a result still awaiting follow-up', () => {
    const result = attributeVirtualTransaction(input());

    expect(result.processQuality).toBe('good');
    expect(result.resultQuality).toBe('pending_follow_up');
    expect(result.evidence.some(item => item.kind === 'fact')).toBe(true);
  });

  it('blocks conclusions when frozen evidence is incomplete', () => {
    const result = attributeVirtualTransaction(input({
      dataQualityBlockingIssues: ['000001可用K线少于60个交易日'],
    }));

    expect(result.confidence).toBe(0);
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'insufficient_evidence' }),
    ]));
  });
});
