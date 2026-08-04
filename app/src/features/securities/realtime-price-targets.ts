import type { StockQuote } from '../../infrastructure/market-data/stock-api';

export interface RealtimePriceTargets {
  buyPrice: string;
  sellPrice: string;
  stopLoss: string;
  supportLevel: string;
  resistanceLevel: string;
  atr: string;
  position: string;
  positionNote: string;
}

export function computeRealtimePriceTargets(
  klines: any[],
  stock: StockQuote,
): RealtimePriceTargets | null {
  if (klines.length < 20) return null;
  const last = klines[klines.length - 1];
  const price = stock.price;
  const recent20 = klines.slice(-20);
  const low20 = Math.min(...recent20.map((k: any) => k.low));
  const high20 = Math.max(...recent20.map((k: any) => k.high));
  const bollLower = last?.boll?.lower;
  const bollUpper = last?.boll?.upper;
  const ma20 = last?.ma?.ma20;
  const atr = last?.atr || (high20 - low20) / 10;

  const supportCandidates = [bollLower, low20, ma20 ? ma20 - 2 * atr : null]
    .filter(value => value && value < price) as number[];
  const supportLevel = supportCandidates.length > 0 ? Math.max(...supportCandidates) : low20;

  const resistanceCandidates = [bollUpper, high20, ma20 ? ma20 + 2 * atr : null]
    .filter(value => value && value > price) as number[];
  const resistanceLevel = resistanceCandidates.length > 0 ? Math.min(...resistanceCandidates) : high20;

  const structuralBuy = supportLevel * 1.02;
  const structuralSell = resistanceLevel * 0.98;
  const buyPriceNumber = Math.min(price * 0.999, Math.max(structuralBuy, price - atr));
  const sellPriceNumber = structuralSell > price
    ? Math.min(structuralSell, price + atr)
    : price + atr;
  const buyPrice = buyPriceNumber.toFixed(2);
  const sellPrice = Math.max(price * 1.001, sellPriceNumber).toFixed(2);
  const stopLoss = (supportLevel - atr).toFixed(2);

  const riskPerShare = Number.parseFloat(buyPrice) - Number.parseFloat(stopLoss);
  const positionPct = riskPerShare > 0 && price > 0
    ? Math.min(30, Math.max(5, Math.round((atr / price) * 100 * 2)))
    : 10;

  return {
    buyPrice,
    sellPrice,
    stopLoss: Number.parseFloat(stopLoss) > 0 ? stopLoss : (price * 0.93).toFixed(2),
    supportLevel: supportLevel.toFixed(2),
    resistanceLevel: resistanceLevel.toFixed(2),
    atr: atr.toFixed(2),
    position: `${positionPct}%`,
    positionNote: positionPct <= 10 ? '保守仓位' : positionPct <= 20 ? '适中仓位' : '积极仓位',
  };
}
