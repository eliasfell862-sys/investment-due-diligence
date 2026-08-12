import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchEastmoneyKLine, type StockKLine, type StockQuote } from '../../../infrastructure/market-data/stock-api';
import { calibrateTTradeParameters } from './t-trading-calibration';
import { buildTTradeMarketStructure } from './t-trading-market-structure';
import { evaluateTTradeSell } from './t-trading-signal-engine';
import type { TradingFeeProfile } from './t-trading-types';

export interface ForegroundTTradePosition {
  code: string;
  availableShares: number;
  averageCost: number;
}

export interface ForegroundTTradePlan {
  status: 'loading' | 'ready' | 'waiting' | 'error';
  error: string;
  shares: number;
  sellRange: [number, number] | null;
  buybackRange: [number, number] | null;
}

interface Input {
  positions: ForegroundTTradePosition[];
  quotes: Record<string, StockQuote>;
  quoteAt: string | null;
  marketStatus: string;
  feeProfile: TradingFeeProfile;
}

const loadingPlan = (): ForegroundTTradePlan => ({
  status: 'loading', error: '', shares: 0, sellRange: null, buybackRange: null,
});

export function useForegroundTTradePlans(input: Input): Record<string, ForegroundTTradePlan> {
  const positionKey = input.positions.map(position => (
    `${position.code}:${position.availableShares}:${position.averageCost}`
  )).sort().join(',');
  const stablePositionsRef = useRef<{ key: string; value: ForegroundTTradePosition[] }>({ key: '', value: [] });
  if (stablePositionsRef.current.key !== positionKey) {
    stablePositionsRef.current = {
      key: positionKey,
      value: input.positions.map(position => ({ ...position })),
    };
  }
  const stablePositions = stablePositionsRef.current.value;
  const codes = useMemo(() => stablePositions.map(position => position.code).sort(), [stablePositions]);
  const quoteKey = codes.map(code => {
    const quote = input.quotes[code];
    return quote
      ? [code, quote.price, quote.open, quote.high, quote.low, quote.volume, quote.amount, quote.change].join(':')
      : code;
  }).join(',');
  const stableQuotesRef = useRef<{ key: string; value: Record<string, StockQuote> }>({ key: '', value: {} });
  if (stableQuotesRef.current.key !== quoteKey) {
    stableQuotesRef.current = {
      key: quoteKey,
      value: Object.fromEntries(codes.map(code => [
        code, input.quotes[code],
      ]).filter((entry): entry is [string, StockQuote] => Boolean(entry[1]))),
    };
  }
  const stableQuotes = stableQuotesRef.current.value;
  const [plans, setPlans] = useState<Record<string, ForegroundTTradePlan>>({});
  const klineCache = useRef(new Map<string, Promise<StockKLine[]>>());

  useEffect(() => {
    let cancelled = false;
    const nextLoading = Object.fromEntries(codes.map(code => [code, loadingPlan()]));
    setPlans(nextLoading);
    void Promise.all(stablePositions.map(async position => {
      const quote = stableQuotes[position.code];
      if (!quote || quote.price <= 0 || !input.quoteAt) {
        return [position.code, { ...loadingPlan(), status: 'waiting' as const }] as const;
      }
      try {
        const tradingDate = input.quoteAt.slice(0, 10);
        const cacheKey = `${position.code}:${tradingDate}`;
        let historyRequest = klineCache.current.get(cacheKey);
        if (!historyRequest) {
          historyRequest = fetchEastmoneyKLine(position.code, 250);
          klineCache.current.set(cacheKey, historyRequest);
        }
        let klines: StockKLine[];
        try {
          klines = await historyRequest;
        } catch (error) {
          klineCache.current.delete(cacheKey);
          throw error;
        }
        if (klines.length < 20) throw new Error('未获取到历史 K 线');
        const market = buildTTradeMarketStructure({
          klines, quote, quoteAt: input.quoteAt, evaluatedAt: input.quoteAt,
          marketStatus: input.marketStatus,
        });
        const calibration = calibrateTTradeParameters({ klines, feeProfile: input.feeProfile });
        const decision = evaluateTTradeSell({
          availableShares: position.availableShares,
          averageCost: position.averageCost,
          currentPrice: quote.price,
          marketStructure: market,
          averageDailyAmount: Math.max(quote.amount, 1),
          feeProfile: input.feeProfile,
          intradayRejection: quote.high > quote.price && quote.price <= quote.high * 0.995,
          calibratedBuybackAtr: calibration.parameters.buybackAtrMultiple,
          evaluatedAt: input.quoteAt,
          expiresAt: `${input.quoteAt.slice(0, 10)}T07:00:00.000Z`,
          strategyVersion: 'foreground-1',
        });
        if (decision.kind !== 'sell') {
          return [position.code, {
            status: 'waiting' as const, error: '', shares: 0,
            sellRange: null, buybackRange: null,
          }] as const;
        }
        return [position.code, {
          status: 'ready' as const,
          error: '',
          shares: decision.recommendation.shares,
          sellRange: decision.recommendation.sellRange,
          buybackRange: decision.recommendation.buybackRange,
        }] as const;
      } catch (error) {
        return [position.code, {
          status: 'error' as const,
          error: error instanceof Error ? error.message : String(error),
          shares: 0, sellRange: null, buybackRange: null,
        }] as const;
      }
    })).then(entries => {
      if (!cancelled) setPlans(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [positionKey, codes, stablePositions, quoteKey, stableQuotes, input.quoteAt, input.marketStatus, input.feeProfile]);

  return plans;
}
