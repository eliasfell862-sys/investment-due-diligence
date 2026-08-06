import { useCallback, useEffect, useMemo, useState } from 'react';
import { scanPreMoveRadar, type PreMoveRadarScanResult } from './radar-service';
import type { PreMovePrediction } from './types';

export type PreMoveRadarFilter = 'all' | 'watchlist' | 'rotation';

export function usePreMoveRadar(): {
  result: PreMoveRadarScanResult | null;
  visiblePredictions: PreMovePrediction[];
  filter: PreMoveRadarFilter;
  setFilter: (value: PreMoveRadarFilter) => void;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
} {
  const [result, setResult] = useState<PreMoveRadarScanResult | null>(null);
  const [filter, setFilter] = useState<PreMoveRadarFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (force: boolean) => {
    setLoading(true); setError('');
    try { setResult(await scanPreMoveRadar({ force })); }
    catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(false); }, [load]);
  const visiblePredictions = useMemo(() => {
    if (!result) return [];
    if (filter === 'watchlist') return result.predictions.filter(item => item.source !== 'rotation');
    if (filter === 'rotation') return result.predictions.filter(item => item.source !== 'watchlist');
    return result.predictions;
  }, [filter, result]);

  return { result, visiblePredictions, filter, setFilter, loading, error, refresh: () => load(true) };
}