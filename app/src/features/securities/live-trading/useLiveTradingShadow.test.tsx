import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EastmoneyOcrAccountSnapshot, LiveTradingCandidate } from './live-trading-types';

const mocks = vi.hoisted(() => ({
  securitiesState: vi.fn(),
  realtime: vi.fn(),
  risk: vi.fn(),
  signal: vi.fn(),
  append: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock('../state/securities-state-context', () => ({
  useOptionalSecuritiesState: () => mocks.securitiesState(),
}));

vi.mock('../useRealtimeStockQuotes', () => ({
  useRealtimeStockQuotes: (codes: string[]) => mocks.realtime(codes),
}));

vi.mock('./live-trading-risk-engine', () => ({
  planLiveBuy: (input: unknown) => mocks.risk(input),
}));

vi.mock('./live-trading-signal-policy', () => ({
  evaluateLiveTradingSignal: (input: unknown) => mocks.signal(input),
}));

vi.mock('./shadow-trading-store', () => ({
  createShadowTradingStore: () => ({
    append: mocks.append,
    snapshot: mocks.snapshot,
  }),
}));

import { useLiveTradingShadow } from './useLiveTradingShadow';

function quote(code: string, price: number) {
  return {
    code, name: code, market: code.startsWith('6') ? 'sh' : 'sz', price,
    change: 0, changePct: 0, open: price, high: price, low: price,
    volume: 1, amount: 100_000_000, preClose: price, turnover: 1,
    pe: 10, pb: 1, totalShares: 1, floatShares: 1, totalCap: 1, floatCap: 1,
  };
}

function candidate(): LiveTradingCandidate {
  return {
    code: '000333', name: 'Midea', price: 10,
    shortAdvice: {
      code: '000333', horizon: '3_10_trading_days', action: 'buy_on_dip', label: '' as never,
      score: 72, confidence: 80, confidenceLabel: '' as never,
      entryRange: { low: 9.8, high: 10 }, stopLoss: 9.5, takeProfit1: 10.5, takeProfit2: 11,
      maxHoldingTradingDays: 7, riskRewardRatio: 2, reasons: ['trend'], risks: [], evidence: [],
      dataCompleteness: { quote: true, kline: true, indicators: true, strategies: true },
      dataAsOf: '2026-08-17', calculatedAt: '2026-08-17T02:00:00Z', cacheStatus: 'fresh',
    },
    mediumAdvice: {
      code: '000333', horizon: '1_3_months', action: 'accumulate', label: '' as never,
      score: 80, confidence: 80, confidenceLabel: '' as never, reasons: ['quality'], risks: [],
      dataCompleteness: { quote: true, kline: true, fundamental: true }, calculatedAt: '2026-08-17T02:00:00Z',
    },
    formalTargets: { buyPrice: 9.9, sellPrice: 10.6, stopLoss: 9.4, supportLevel: 9.6, resistanceLevel: 10.8, atr: 0.3 },
    combinedScore: 76.8, dataFresh: true, dataAsOf: '2026-08-17', failureReasons: [],
  };
}

function account(overrides: Partial<EastmoneyOcrAccountSnapshot> = {}): EastmoneyOcrAccountSnapshot {
  return {
    mode: 'eastmoney_read_only', source: 'eastmoney_windows_ocr', available: true,
    capturedAt: '2026-08-17T02:30:00Z', quality: 'verification_required',
    verificationRequired: true, availableCash: 500, totalAssets: 1500,
    positions: [{ code: '600519', totalShares: 100, availableShares: 40 }],
    failureReason: null, ...overrides,
  };
}

function installElectron(accountSnapshot: EastmoneyOcrAccountSnapshot) {
  Object.defineProperty(window, 'electronTrading', {
    configurable: true,
    value: {
      getStatus: vi.fn().mockResolvedValue({ state: 'ready', port: 8765, lastError: null }),
      readEastmoneyAccount: vi.fn().mockResolvedValue(accountSnapshot),
      runEastmoneyProbe: vi.fn(),
      submitShadowOrder: vi.fn().mockResolvedValue({ status: 'accepted' }),
      cancelShadowOrder: vi.fn(),
    },
  });
}

async function readyHook() {
  const hook = renderHook(() => useLiveTradingShadow());
  await waitFor(() => expect(hook.result.current.bridgeStatus.state).toBe('ready'));
  return hook;
}

describe('useLiveTradingShadow confirmed OCR account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.securitiesState.mockReturnValue({
      userId: 'user-a',
      watchlists: { data: [{ id: 'wl', name: 'watch', codes: ['000333'] }] },
      positions: { data: { positions: [{ code: '000001', totalCost: 1000 }] } },
    });
    mocks.realtime.mockReturnValue({
      quotes: { '000333': quote('000333', 10), '600519': quote('600519', 10) },
      refreshNow: vi.fn(), refreshing: false, marketStatus: 'trading',
      lastUpdatedAt: '2026-08-17T02:30:00Z', stale: false, error: '',
    });
    mocks.signal.mockReturnValue({ kind: 'core_buy' });
    mocks.risk.mockReturnValue({
      allowed: true, shares: 100, entryFees: 5, estimatedExitFees: 6,
      plannedLoss: 61, projectedInvested: 1995, projectedStockMarketValue: 990,
      projectedAvailableCash: 4000,
    });
    mocks.snapshot.mockReturnValue({ orders: [], reservedTBuybackCash: 0 });
  });

  it('does not use an unconfirmed OCR draft for risk sizing', async () => {
    installElectron(account());
    const { result } = await readyHook();
    await act(async () => { await result.current.readEastmoneyAccount(); });
    await act(async () => { await result.current.submitCandidate(candidate()); });

    expect(mocks.risk).toHaveBeenLastCalledWith(expect.objectContaining({
      availableCash: 6000, currentInvested: 1000, currentPositionCount: 1,
    }));
  });

  it('uses confirmed OCR cash and quote-valued positions for risk sizing', async () => {
    installElectron(account());
    const { result } = await readyHook();
    await act(async () => { await result.current.readEastmoneyAccount(); });
    act(() => result.current.confirmEastmoneyAccount());
    await act(async () => { await result.current.submitCandidate(candidate()); });

    expect(mocks.risk).toHaveBeenLastCalledWith(expect.objectContaining({
      availableCash: 500, currentInvested: 1000, currentPositionCount: 1,
      currentStockMarketValue: 0, alreadyHoldsStock: false,
    }));
    expect(mocks.realtime).toHaveBeenLastCalledWith(expect.arrayContaining(['000333', '600519']));
  });

  it('blocks confirmed positions when a current quote is missing', async () => {
    mocks.realtime.mockReturnValue({
      quotes: { '000333': quote('000333', 10) }, refreshNow: vi.fn(),
      refreshing: false, marketStatus: 'trading', lastUpdatedAt: null, stale: false, error: '',
    });
    installElectron(account());
    const { result } = await readyHook();
    await act(async () => { await result.current.readEastmoneyAccount(); });
    act(() => result.current.confirmEastmoneyAccount());

    await expect(result.current.submitCandidate(candidate()))
      .rejects.toThrow('confirmed_position_quote_missing');
  });

  it('retains confirmed available shares for future T+1 checks', async () => {
    installElectron(account());
    const { result } = await readyHook();
    await act(async () => { await result.current.readEastmoneyAccount(); });
    act(() => result.current.confirmEastmoneyAccount());

    expect(result.current.confirmedAccount?.positions[0]).toEqual({
      code: '600519', totalShares: 100, availableShares: 40,
    });
  });
});
