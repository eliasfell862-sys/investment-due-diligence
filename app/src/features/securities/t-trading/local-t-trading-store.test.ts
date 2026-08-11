import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TRADING_FEE_PROFILE } from './trading-fee-engine';
import {
  LOCAL_T_TRADING_EVENT,
  LOCAL_T_TRADING_STORAGE_KEY,
  LocalTTradingStateCorruptionError,
  createEmptyLocalTTradingState,
  loadLocalTTradingState,
  saveLocalTTradingState,
} from './local-t-trading-store';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    value: (key: string) => values.get(key) ?? null,
  };
}

describe('local T-trading store', () => {
  it('returns an empty versioned state when storage is absent', () => {
    expect(loadLocalTTradingState(memoryStorage())).toEqual(createEmptyLocalTTradingState());
  });

  it('saves, reloads and announces a valid state', () => {
    const storage = memoryStorage();
    const listener = vi.fn();
    window.addEventListener(LOCAL_T_TRADING_EVENT, listener);

    const state = {
      version: 1 as const,
      feeProfile: { ...DEFAULT_TRADING_FEE_PROFILE },
      cycles: [],
    };
    saveLocalTTradingState(state, storage);

    expect(JSON.parse(storage.value(LOCAL_T_TRADING_STORAGE_KEY)!)).toEqual(state);
    expect(loadLocalTTradingState(storage)).toEqual(state);
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(LOCAL_T_TRADING_EVENT, listener);
  });

  it('throws a typed error for corrupt or structurally invalid JSON', () => {
    expect(() => loadLocalTTradingState(memoryStorage({
      [LOCAL_T_TRADING_STORAGE_KEY]: '{broken',
    }))).toThrow(LocalTTradingStateCorruptionError);

    expect(() => loadLocalTTradingState(memoryStorage({
      [LOCAL_T_TRADING_STORAGE_KEY]: JSON.stringify({ version: 1, cycles: 'bad' }),
    }))).toThrow(LocalTTradingStateCorruptionError);
  });
});
