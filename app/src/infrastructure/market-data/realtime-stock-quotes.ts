import { fetchStockQuotes, type StockQuote } from './stock-api';
import {
  getStockMarketSessionStatus,
  millisecondsUntilNextTradingWindow,
  type StockMarketSessionStatus,
} from './stock-market-session';

const REFRESH_INTERVAL_MS = 3000;
const STALE_AFTER_MS = 60_000;
const MAX_BATCH_SIZE = 80;
const RETRY_DELAYS_MS = [3000, 6000, 12_000, 24_000, 30_000] as const;

export interface RealtimeQuoteSnapshot {
  quotes: Record<string, StockQuote>;
  refreshing: boolean;
  marketStatus: StockMarketSessionStatus;
  lastUpdatedAt: string | null;
  stale: boolean;
  error: string;
}

export interface RealtimeStockQuoteDependencies {
  fetchQuotes: (codes: string[]) => Promise<StockQuote[]>;
  now: () => number;
  setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  isVisible: () => boolean;
  addVisibilityListener: (listener: () => void) => () => void;
  addFocusListener: (listener: () => void) => () => void;
  queueMicrotask: (callback: () => void) => void;
}

export interface RealtimeStockQuoteStore {
  subscribe(
    codes: string[],
    listener: (snapshot: RealtimeQuoteSnapshot) => void,
  ): () => void;
  refresh(codes?: string[]): Promise<void>;
  dispose(): void;
}

interface Subscriber {
  codes: string[];
  listener: (snapshot: RealtimeQuoteSnapshot) => void;
}

export function normalizeStockCodes(codes: string[]): string[] {
  return [...new Set(codes.map(code => code.trim()).filter(Boolean))].sort();
}

function defaultDependencies(): RealtimeStockQuoteDependencies {
  return {
    fetchQuotes: fetchStockQuotes,
    now: Date.now,
    setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer: timer => clearTimeout(timer),
    isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
    addVisibilityListener: listener => {
      if (typeof document === 'undefined') return () => undefined;
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
    addFocusListener: listener => {
      if (typeof window === 'undefined') return () => undefined;
      window.addEventListener('focus', listener);
      return () => window.removeEventListener('focus', listener);
    },
    queueMicrotask: callback => globalThis.queueMicrotask(callback),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function createRealtimeStockQuoteStore(
  dependencies: Partial<RealtimeStockQuoteDependencies> = {},
): RealtimeStockQuoteStore {
  const deps = { ...defaultDependencies(), ...dependencies };
  const subscribers = new Map<symbol, Subscriber>();
  const quoteCache = new Map<string, StockQuote>();

  let activeCodes: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let initialRefreshQueued = false;
  let listenersAttached = false;
  let removeVisibilityListener: (() => void) | null = null;
  let removeFocusListener: (() => void) | null = null;
  let lastSuccessfulAtMs: number | null = null;
  let error = '';
  let failureCount = 0;
  let disposed = false;

  function recomputeActiveCodes() {
    activeCodes = normalizeStockCodes(
      [...subscribers.values()].flatMap(subscriber => subscriber.codes),
    );
  }

  function clearScheduledTimer() {
    if (timer === null) return;
    deps.clearTimer(timer);
    timer = null;
  }

  function createSnapshot(codes: string[]): RealtimeQuoteSnapshot {
    const currentTime = deps.now();
    const marketStatus = getStockMarketSessionStatus(new Date(currentTime));
    const quotes: Record<string, StockQuote> = {};
    for (const code of codes) {
      const cached = quoteCache.get(code);
      if (cached) quotes[code] = cached;
    }

    return {
      quotes,
      refreshing: inFlight !== null,
      marketStatus,
      lastUpdatedAt: lastSuccessfulAtMs === null
        ? null
        : new Date(lastSuccessfulAtMs).toISOString(),
      stale: marketStatus === 'trading'
        && lastSuccessfulAtMs !== null
        && currentTime - lastSuccessfulAtMs > STALE_AFTER_MS,
      error,
    };
  }

  function notifySubscribers() {
    for (const subscriber of subscribers.values()) {
      subscriber.listener(createSnapshot(subscriber.codes));
    }
  }

  function scheduleNextRefresh() {
    clearScheduledTimer();
    if (disposed || subscribers.size === 0 || !deps.isVisible()) return;

    const now = new Date(deps.now());
    const marketStatus = getStockMarketSessionStatus(now);
    const delay = marketStatus === 'trading'
      ? failureCount > 0
        ? RETRY_DELAYS_MS[Math.min(failureCount - 1, RETRY_DELAYS_MS.length - 1)]
        : REFRESH_INTERVAL_MS
      : millisecondsUntilNextTradingWindow(now);

    timer = deps.setTimer(() => {
      timer = null;
      void refresh();
    }, Math.max(0, delay));
  }

  function attachBrowserListeners() {
    if (listenersAttached) return;
    listenersAttached = true;
    removeVisibilityListener = deps.addVisibilityListener(() => {
      if (!deps.isVisible()) {
        clearScheduledTimer();
        return;
      }
      void refresh();
    });
    removeFocusListener = deps.addFocusListener(() => {
      if (deps.isVisible()) void refresh();
    });
  }

  function detachBrowserListeners() {
    if (!listenersAttached) return;
    listenersAttached = false;
    removeVisibilityListener?.();
    removeFocusListener?.();
    removeVisibilityListener = null;
    removeFocusListener = null;
  }

  function queueInitialRefresh() {
    if (initialRefreshQueued) return;
    initialRefreshQueued = true;
    deps.queueMicrotask(() => {
      initialRefreshQueued = false;
      if (!disposed && subscribers.size > 0) void refresh();
    });
  }

  function refresh(codes?: string[]): Promise<void> {
    if (inFlight) return inFlight;

    const requestedCodes = normalizeStockCodes(codes ?? activeCodes);
    if (disposed || requestedCodes.length === 0) return Promise.resolve();

    clearScheduledTimer();
    error = '';

    const batches: string[][] = [];
    for (let index = 0; index < requestedCodes.length; index += MAX_BATCH_SIZE) {
      batches.push(requestedCodes.slice(index, index + MAX_BATCH_SIZE));
    }

    let requests: Promise<StockQuote[]>[];
    try {
      requests = batches.map(batch => Promise.resolve(deps.fetchQuotes(batch)));
    } catch (requestError) {
      requests = [Promise.reject(requestError)];
    }

    inFlight = Promise.all(requests)
      .then(results => {
        for (const result of results.flat()) {
          if (Number.isFinite(result.price) && result.price > 0) {
            quoteCache.set(result.code, result);
          }
        }
        lastSuccessfulAtMs = deps.now();
        failureCount = 0;
      }, requestError => {
        error = errorMessage(requestError);
        failureCount += 1;
      })
      .finally(() => {
        inFlight = null;
        notifySubscribers();
        scheduleNextRefresh();
      });

    notifySubscribers();
    return inFlight;
  }

  function subscribe(
    codes: string[],
    listener: (snapshot: RealtimeQuoteSnapshot) => void,
  ): () => void {
    if (disposed) return () => undefined;

    const key = Symbol('realtime-stock-quote-subscriber');
    const subscriber = { codes: normalizeStockCodes(codes), listener };
    subscribers.set(key, subscriber);
    recomputeActiveCodes();

    if (subscribers.size === 1) attachBrowserListeners();
    listener(createSnapshot(subscriber.codes));
    queueInitialRefresh();

    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      subscribers.delete(key);
      recomputeActiveCodes();
      if (subscribers.size === 0) {
        clearScheduledTimer();
        detachBrowserListeners();
      }
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearScheduledTimer();
    detachBrowserListeners();
    subscribers.clear();
    activeCodes = [];
  }

  return { subscribe, refresh, dispose };
}

export const realtimeStockQuoteStore = createRealtimeStockQuoteStore();
