import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOptionalAuth } from '../../auth/AuthProvider';
import {
  createCloudSecuritiesRepository,
  type ExecuteTTradeBuybackInput,
  type ExecuteTTradeSellInput,
  type ResolveTTradeCycleInput,
  type TTradeMutationResult,
} from '../cloud/cloud-securities-repository';
import {
  LOCAL_T_TRADING_EVENT,
  LOCAL_T_TRADING_STORAGE_KEY,
  createEmptyLocalTTradingState,
  loadLocalTTradingState,
  saveLocalTTradingState,
} from './local-t-trading-store';
import type { LocalTTradingState, TradingFeeProfile } from './t-trading-types';

function emptyState(): LocalTTradingState {
  return createEmptyLocalTTradingState();
}

export function useTTradingState() {
  const auth = useOptionalAuth();
  const cloudMode = Boolean(auth?.cloudEnabled && auth.user);
  const authLoading = Boolean(auth?.loading);
  const userId = auth?.user?.id ?? null;
  const repository = useMemo(() => createCloudSecuritiesRepository(), []);
  const [state, setState] = useState<LocalTTradingState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (authLoading) {
      setLoading(true);
      return;
    }
    setLoading(true);
    try {
      const nextState = cloudMode
        ? await repository.loadTTradingState()
        : loadLocalTTradingState();
      setState(nextState);
      setError('');
    } catch (loadError) {
      setState(emptyState());
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [authLoading, cloudMode, repository]);

  const saveTradingFeeProfile = useCallback(async (profile: TradingFeeProfile) => {
    if (cloudMode) {
      await repository.saveTradingFeeProfile(profile);
    } else {
      const current = loadLocalTTradingState();
      saveLocalTTradingState({ ...current, feeProfile: { ...profile } });
    }
    await reload();
  }, [cloudMode, reload, repository]);

  const executeTTradeSell = useCallback(async (
    input: ExecuteTTradeSellInput,
  ): Promise<TTradeMutationResult> => {
    if (!cloudMode) throw new Error('Local T execution is handled by the foreground inbox');
    const result = await repository.executeTTradeSell(input);
    await reload();
    return result;
  }, [cloudMode, reload, repository]);

  const executeTTradeBuyback = useCallback(async (
    input: ExecuteTTradeBuybackInput,
  ): Promise<TTradeMutationResult> => {
    if (!cloudMode) throw new Error('Local T execution is handled by the foreground inbox');
    const result = await repository.executeTTradeBuyback(input);
    await reload();
    return result;
  }, [cloudMode, reload, repository]);

  const resolveTTradeCycle = useCallback(async (
    input: ResolveTTradeCycleInput,
  ): Promise<TTradeMutationResult> => {
    if (!cloudMode) throw new Error('Local T resolution is handled by the foreground inbox');
    const result = await repository.resolveTTradeCycle(input);
    await reload();
    return result;
  }, [cloudMode, reload, repository]);

  useEffect(() => {
    void reload();
    if (authLoading) return undefined;

    if (cloudMode && userId) {
      const unsubscribe = repository.subscribeTTradingState(userId, () => { void reload(); });
      const onFocus = () => { void reload(); };
      window.addEventListener('focus', onFocus);
      return () => {
        unsubscribe();
        window.removeEventListener('focus', onFocus);
      };
    }

    const onLocalChange = () => { void reload(); };
    const onStorage = (event: StorageEvent) => {
      if (event.key === LOCAL_T_TRADING_STORAGE_KEY) void reload();
    };
    window.addEventListener(LOCAL_T_TRADING_EVENT, onLocalChange);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onLocalChange);
    return () => {
      window.removeEventListener(LOCAL_T_TRADING_EVENT, onLocalChange);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onLocalChange);
    };
  }, [authLoading, cloudMode, reload, repository, userId]);

  return {
    state,
    loading,
    error,
    cloudMode,
    reload,
    saveTradingFeeProfile,
    executeTTradeSell,
    executeTTradeBuyback,
    resolveTTradeCycle,
  };
}
