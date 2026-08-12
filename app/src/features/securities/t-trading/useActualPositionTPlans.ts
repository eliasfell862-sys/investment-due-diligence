import { useEffect, useState } from 'react';
import {
  fetchEastmoneyKLine,
  type StockQuote,
} from '../../../infrastructure/market-data/stock-api';
import {
  evaluateActualPositionTPlan,
  type ActualPositionTPlan,
} from './actual-position-t-plan';
import type { TradingFeeProfile } from './t-trading-types';

export interface ActualPositionTPlanCandidate {
  id: string;
  code: string;
  averageCost: number;
  availableShares: number;
}

interface UseActualPositionTPlansInput {
  positions: ActualPositionTPlanCandidate[];
  quotes: Record<string, StockQuote>;
  quoteAt: string | null;
  marketStatus: string;
  quoteStale: boolean;
  feeProfile: TradingFeeProfile;
}

export function useActualPositionTPlans(
  input: UseActualPositionTPlansInput,
): Record<string, ActualPositionTPlan> {
  const [plans, setPlans] = useState<Record<string, ActualPositionTPlan>>({});

  useEffect(() => {
    let cancelled = false;
    const initial: Record<string, ActualPositionTPlan> = {};
    for (const position of input.positions) {
      initial[position.code] = input.quoteStale
        ? { status: 'stale' }
        : input.quotes[position.code]
          ? { status: 'loading' }
          : { status: 'no_quote' };
    }
    setPlans(initial);

    void Promise.all(input.positions.map(async position => {
      const quote = input.quotes[position.code];
      if (input.quoteStale || !quote) return [position.code, initial[position.code]] as const;
      try {
        const klines = await fetchEastmoneyKLine(position.code, 250);
        if (klines.length === 0) {
          return [position.code, {
            status: 'error',
            message: '未获取到历史 K 线，请刷新后重试',
          } satisfies ActualPositionTPlan] as const;
        }
        return [position.code, evaluateActualPositionTPlan({
          klines,
          quote,
          quoteAt: input.quoteAt,
          marketStatus: input.marketStatus,
          quoteStale: input.quoteStale,
          availableShares: position.availableShares,
          averageCost: position.averageCost,
          feeProfile: input.feeProfile,
        })] as const;
      } catch (error) {
        return [position.code, {
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        } satisfies ActualPositionTPlan] as const;
      }
    })).then(entries => {
      if (!cancelled) setPlans(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [
    input.positions,
    input.quotes,
    input.quoteAt,
    input.marketStatus,
    input.quoteStale,
    input.feeProfile,
  ]);

  return plans;
}