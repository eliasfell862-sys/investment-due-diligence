import { useEffect, useRef } from 'react';
import { fetchCsi300Klines } from '../../../infrastructure/market-data/pre-move-market-data-api';
import { fetchEastmoneyKLine } from '../../../infrastructure/market-data/stock-api';
import { evaluateDuePredictions } from './forward-evaluator';
import { preMoveRadarDb } from './radar-db';
import { PreMoveRadarRepository } from './radar-repository';

export const PRE_MOVE_OUTCOMES_UPDATED_EVENT = 'sec-pre-move-outcomes-updated';
export const PRE_MOVE_OUTCOMES_ERROR_EVENT = 'sec-pre-move-outcomes-error';

const repository = new PreMoveRadarRepository(preMoveRadarDb);

function shanghaiDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function defaultCatchUp(): Promise<{ completed: number; pending: number }> {
  const asOfTradingDate = shanghaiDate();
  const result = await evaluateDuePredictions({ asOfTradingDate, repository,
    loadStockBars: async (code, endDate) => (await fetchEastmoneyKLine(code, 40)).filter(bar => bar.date <= endDate),
    loadBenchmarkBars: async endDate => {
      const response = await fetchCsi300Klines(40);
      if (response.meta.status === 'error') throw new Error(response.meta.error || '沪深300日线不可用');
      return response.data.filter(bar => bar.date <= endDate);
    } });
  return { completed: result.completedPredictionIds.length, pending: result.pendingPredictionIds.length };
}

export function usePreMoveOutcomeScheduler(options: {
  intervalMs?: number;
  runCatchUp?: () => Promise<{ completed: number; pending: number }>;
} = {}): void {
  const intervalMs = options.intervalMs ?? 60 * 60 * 1000;
  const runCatchUp = options.runCatchUp ?? defaultCatchUp;
  const running = useRef(false);

  useEffect(() => {
    let disposed = false;
    const run = async () => {
      if (running.current || disposed) return;
      running.current = true;
      try {
        const result = await runCatchUp();
        if (!disposed && result.completed > 0 && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(PRE_MOVE_OUTCOMES_UPDATED_EVENT, { detail: result }));
        }
      } catch (error) {
        if (!disposed && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(PRE_MOVE_OUTCOMES_ERROR_EVENT, { detail: error instanceof Error ? error.message : String(error) }));
        }
      } finally { running.current = false; }
    };
    void run();
    const timer = window.setInterval(() => { void run(); }, intervalMs);
    const onVisible = () => { if (document.visibilityState !== 'hidden') void run(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { disposed = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [intervalMs, runCatchUp]);
}