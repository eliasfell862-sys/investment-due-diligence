export interface TechnicalIndicatorWeights {
  macd: number;
  kdj: number;
  rsi: number;
  boll: number;
  ma20: number;
}

export interface TechnicalStrategyConfig {
  strategyId: string;
  version: string;
  buyScoreThreshold: number;
  sellScoreThreshold: number;
  weights: TechnicalIndicatorWeights;
  kdjBuyThreshold: number;
  kdjSellThreshold: number;
  rsiBuyThreshold: number;
  bollTolerancePct: number;
  stopLossPct: number;
  maxHoldingDays: number;
}

export const DEFAULT_TECHNICAL_STRATEGY_CONFIG: TechnicalStrategyConfig = {
  strategyId: 'realtime-technical',
  version: '1',
  buyScoreThreshold: 1,
  sellScoreThreshold: 1,
  weights: { macd: 1, kdj: 1, rsi: 1, boll: 1, ma20: 1 },
  kdjBuyThreshold: 20,
  kdjSellThreshold: 85,
  rsiBuyThreshold: 30,
  bollTolerancePct: 1,
  stopLossPct: 8,
  maxHoldingDays: 60,
};

const inRange = (value: number, minimum: number, maximum: number) =>
  Number.isFinite(value) && value >= minimum && value <= maximum;

export function validateTechnicalStrategyConfig(config: TechnicalStrategyConfig) {
  if (Object.values(config.weights).some(weight => !inRange(weight, 0, 2))) {
    throw new Error('指标权重必须在0到2之间');
  }
  if (!inRange(config.buyScoreThreshold, 0.5, 5) || !inRange(config.sellScoreThreshold, 0.5, 5)) {
    throw new Error('信号分数阈值必须在0.5到5之间');
  }
  if (!inRange(config.kdjBuyThreshold, 5, 35)) throw new Error('KDJ买入阈值必须在5到35之间');
  if (!inRange(config.kdjSellThreshold, 65, 95)) throw new Error('KDJ卖出阈值必须在65到95之间');
  if (!inRange(config.rsiBuyThreshold, 15, 40)) throw new Error('RSI买入阈值必须在15到40之间');
  if (!inRange(config.bollTolerancePct, 0, 3)) throw new Error('布林带容差必须在0%到3%之间');
  if (!inRange(config.stopLossPct, 3, 15)) throw new Error('止损比例必须在3%到15%之间');
  if (!inRange(config.maxHoldingDays, 5, 120)) throw new Error('最长持仓日必须在5到120之间');
  return structuredClone(config);
}
