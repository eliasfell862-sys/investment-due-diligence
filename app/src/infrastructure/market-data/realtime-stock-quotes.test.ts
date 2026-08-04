import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StockQuote } from './stock-api';
import {
  createRealtimeStockQuoteStore,
  normalizeStockCodes,
  type RealtimeQuoteSnapshot,
  type RealtimeStockQuoteDependencies,
  type RealtimeStockQuoteStore,
} from './realtime-stock-quotes';

function quote(code: string, price: number): StockQuote {
  return {
    code,
    name: code,
    market: code.startsWith('6') ? 'sh' : 'sz',
    price,
    change: 0,
    changePct: 0,
    open: price,
    high: price,
    low: price,
    volume: 1,
    amount: price,
    preClose: price,
    turnover: 0,
    pe: 0,
    pb: 0,
    totalShares: 0,
    floatShares: 0,
    totalCap: 0,
    floatCap: 0,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function mutableClock(initialIso: string) {
  let current = new Date(initialIso).getTime();
  return {
    now: () => current,
    set: (iso: string) => { current = new Date(iso).getTime(); },
  };
}

function mutableVisibility(initial: boolean) {
  let visible = initial;
  let visibilityListener = () => undefined;
  const removeVisibilityListener = vi.fn();
  const removeFocusListener = vi.fn();

  return {
    dependencies: {
      isVisible: () => visible,
      addVisibilityListener: (listener: () => void) => {
        visibilityListener = listener;
        return removeVisibilityListener;
      },
      addFocusListener: () => removeFocusListener,
    } satisfies Partial<RealtimeStockQuoteDependencies>,
    show() {
      visible = true;
      visibilityListener();
    },
    hide() {
      visible = false;
      visibilityListener();
    },
    removeVisibilityListener,
    removeFocusListener,
  };
}

const stores: RealtimeStockQuoteStore[] = [];

function setupStore(overrides: Partial<RealtimeStockQuoteDependencies> = {}) {
  const fetchQuotes = overrides.fetchQuotes
    ? vi.mocked(overrides.fetchQuotes)
    : vi.fn(async (codes: string[]) => codes.map(code => quote(code, 10)));
  const store = createRealtimeStockQuoteStore({ fetchQuotes, ...overrides });
  stores.push(store);
  return { store, fetchQuotes };
}

function setupTradingStore(overrides: Partial<RealtimeStockQuoteDependencies> = {}) {
  return setupStore({
    now: () => new Date('2026-08-03T10:00:00+08:00').getTime(),
    ...overrides,
  });
}

function lastSnapshot(listener: ReturnType<typeof vi.fn>): RealtimeQuoteSnapshot {
  return listener.mock.calls.at(-1)?.[0] as RealtimeQuoteSnapshot;
}

async function flushMicrotasks() {
  await vi.runAllTicks();
  await Promise.resolve();
  await Promise.resolve();
}

describe('realtime stock quote store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stores.splice(0).forEach(store => store.dispose());
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('normalizes, deduplicates, and sorts subscribed codes', () => {
    expect(normalizeStockCodes(['600519', '000001', '600519', '', ' 000001 ']))
      .toEqual(['000001', '600519']);
  });

  it('merges overlapping subscribers into one immediate batch request', async () => {
    const { store, fetchQuotes } = setupTradingStore();
    const stopOne = store.subscribe(['000001', '600519'], vi.fn());
    const stopTwo = store.subscribe(['600519', '000333'], vi.fn());
    await flushMicrotasks();
    expect(fetchQuotes).toHaveBeenCalledTimes(1);
    expect(fetchQuotes).toHaveBeenCalledWith(['000001', '000333', '600519']);
    stopOne();
    stopTwo();
  });

  it('splits requests into batches of at most 80 codes', async () => {
    const { store, fetchQuotes } = setupTradingStore();
    const codes = Array.from({ length: 161 }, (_, index) => String(index).padStart(6, '0'));
    store.subscribe(codes, vi.fn());
    await flushMicrotasks();
    expect(fetchQuotes.mock.calls.map(call => call[0].length)).toEqual([80, 80, 1]);
  });

  it('refreshes every three seconds during trading hours', async () => {
    const { store, fetchQuotes } = setupTradingStore();
    store.subscribe(['000001'], vi.fn());
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchQuotes).toHaveBeenCalledTimes(2);
  });

  it('does not issue automatic requests during lunch and wakes at 12:55', async () => {
    const clock = mutableClock('2026-08-03T11:35:00+08:00');
    const { store, fetchQuotes } = setupStore({ now: clock.now });
    store.subscribe(['000001'], vi.fn());
    await flushMicrotasks();
    expect(fetchQuotes).toHaveBeenCalledTimes(1);
    clock.set('2026-08-03T12:55:00+08:00');
    await vi.advanceTimersByTimeAsync(80 * 60 * 1000);
    expect(fetchQuotes).toHaveBeenCalledTimes(2);
  });

  it('pauses while hidden and refreshes immediately after visibility returns', async () => {
    const visible = mutableVisibility(false);
    const { store, fetchQuotes } = setupTradingStore(visible.dependencies);
    store.subscribe(['000001'], vi.fn());
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(9000);
    expect(fetchQuotes).toHaveBeenCalledTimes(1);
    visible.show();
    await flushMicrotasks();
    expect(fetchQuotes).toHaveBeenCalledTimes(2);
  });

  it('reuses the in-flight request instead of overlapping manual refreshes', async () => {
    const deferred = createDeferred<StockQuote[]>();
    const fetchQuotes = vi.fn().mockReturnValue(deferred.promise);
    const { store } = setupTradingStore({ fetchQuotes });
    store.subscribe(['000001'], vi.fn());
    const first = store.refresh(['000001']);
    const second = store.refresh(['000001']);
    expect(first).toBe(second);
    expect(fetchQuotes).toHaveBeenCalledTimes(1);
    deferred.resolve([quote('000001', 12)]);
    await first;
  });

  it('preserves the last good quote when a later batch omits the code', async () => {
    const fetchQuotes = vi.fn()
      .mockResolvedValueOnce([quote('000001', 12), quote('600519', 1300)])
      .mockResolvedValueOnce([quote('600519', 1301)]);
    const listener = vi.fn();
    const { store } = setupTradingStore({ fetchQuotes });
    store.subscribe(['000001', '600519'], listener);
    await flushMicrotasks();
    await store.refresh();
    expect(lastSnapshot(listener).quotes['000001'].price).toBe(12);
    expect(lastSnapshot(listener).quotes['600519'].price).toBe(1301);
  });

  it('preserves quotes and exposes an error after a failed refresh', async () => {
    const fetchQuotes = vi.fn()
      .mockResolvedValueOnce([quote('000001', 12)])
      .mockRejectedValueOnce(new Error('network'));
    const listener = vi.fn();
    const { store } = setupTradingStore({ fetchQuotes });
    store.subscribe(['000001'], listener);
    await flushMicrotasks();
    await store.refresh();
    expect(lastSnapshot(listener)).toMatchObject({ error: 'network' });
    expect(lastSnapshot(listener).quotes['000001'].price).toBe(12);
  });

  it('backs off 3, 6, 12, 24, then 30 seconds and resets after success', async () => {
    const fetchQuotes = vi.fn()
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockRejectedValueOnce(new Error('3'))
      .mockRejectedValueOnce(new Error('4'))
      .mockRejectedValueOnce(new Error('5'))
      .mockResolvedValue([quote('000001', 12)]);
    const { store } = setupTradingStore({ fetchQuotes });
    store.subscribe(['000001'], vi.fn());
    await flushMicrotasks();
    for (const delay of [3000, 6000, 12000, 24000, 30000]) {
      await vi.advanceTimersByTimeAsync(delay);
    }
    expect(fetchQuotes).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchQuotes).toHaveBeenCalledTimes(7);
  });

  it('merges only finite positive prices and filters snapshots per subscriber', async () => {
    const fetchQuotes = vi.fn().mockResolvedValue([
      quote('000001', 12),
      quote('000002', 0),
      quote('000003', Number.NaN),
      quote('600519', 1300),
    ]);
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const { store } = setupTradingStore({ fetchQuotes });
    store.subscribe(['000001', '000002', '000003'], firstListener);
    store.subscribe(['600519'], secondListener);
    await flushMicrotasks();
    expect(Object.keys(lastSnapshot(firstListener).quotes)).toEqual(['000001']);
    expect(Object.keys(lastSnapshot(secondListener).quotes)).toEqual(['600519']);
  });

  it('marks retained quotes stale after more than 60 seconds of trading-time failures', async () => {
    let current = new Date('2026-08-03T10:00:00+08:00').getTime();
    const fetchQuotes = vi.fn()
      .mockResolvedValueOnce([quote('000001', 12)])
      .mockRejectedValue(new Error('network'));
    const listener = vi.fn();
    const { store } = setupStore({ fetchQuotes, now: () => current });
    store.subscribe(['000001'], listener);
    await flushMicrotasks();
    for (const delay of [3000, 6000, 12000, 24000, 30000]) {
      current += delay;
      await vi.advanceTimersByTimeAsync(delay);
    }
    expect(lastSnapshot(listener).stale).toBe(true);
    expect(lastSnapshot(listener).quotes['000001'].price).toBe(12);
  });

  it('cleans up timers and browser listeners after the last unsubscribe', async () => {
    const visible = mutableVisibility(true);
    const { store } = setupTradingStore(visible.dependencies);
    const stop = store.subscribe(['000001'], vi.fn());
    await flushMicrotasks();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(visible.removeVisibilityListener).toHaveBeenCalledOnce();
    expect(visible.removeFocusListener).toHaveBeenCalledOnce();
  });

  it('can be disposed repeatedly', () => {
    const { store } = setupTradingStore();
    expect(() => {
      store.dispose();
      store.dispose();
    }).not.toThrow();
  });
});
