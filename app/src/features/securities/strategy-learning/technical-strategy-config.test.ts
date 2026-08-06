import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TECHNICAL_STRATEGY_CONFIG,
  validateTechnicalStrategyConfig,
} from './technical-strategy-config';

describe('technical strategy config', () => {
  it('keeps the original single-signal behavior by default', () => {
    expect(DEFAULT_TECHNICAL_STRATEGY_CONFIG).toMatchObject({
      version: '1',
      buyScoreThreshold: 1,
      sellScoreThreshold: 1,
      weights: { macd: 1, kdj: 1, rsi: 1, boll: 1, ma20: 1 },
    });
    expect(validateTechnicalStrategyConfig(DEFAULT_TECHNICAL_STRATEGY_CONFIG))
      .toEqual(DEFAULT_TECHNICAL_STRATEGY_CONFIG);
  });

  it('rejects unsafe parameters', () => {
    expect(() => validateTechnicalStrategyConfig({
      ...DEFAULT_TECHNICAL_STRATEGY_CONFIG,
      stopLossPct: 35,
    })).toThrow('止损比例必须在3%到15%之间');

    expect(() => validateTechnicalStrategyConfig({
      ...DEFAULT_TECHNICAL_STRATEGY_CONFIG,
      weights: { ...DEFAULT_TECHNICAL_STRATEGY_CONFIG.weights, rsi: 2.1 },
    })).toThrow('指标权重必须在0到2之间');
  });
});
