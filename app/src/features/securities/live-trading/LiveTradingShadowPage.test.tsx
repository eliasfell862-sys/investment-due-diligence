import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveTradingCandidate } from './live-trading-types';

const mocks = vi.hoisted(() => ({
  hook: vi.fn(),
}));

vi.mock('./useLiveTradingShadow', () => ({
  useLiveTradingShadow: mocks.hook,
}));

import { LiveTradingShadowPage } from './LiveTradingShadowPage';

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

function hook(overrides: Record<string, unknown> = {}) {
  return {
    bridgeStatus: { state: 'ready', port: 8765, lastError: null },
    probeReport: null, candidates: [], orders: [], reservedTBuybackCash: 0,
    validShadowOrders: 0, blockingFailures: 0, analyzing: false, error: '',
    scanCandidates: vi.fn(), runProbe: vi.fn(), submitCandidate: vi.fn(),
    ...overrides,
  };
}

describe('LiveTradingShadowPage', () => {
  beforeEach(() => {
    mocks.hook.mockReturnValue(hook());
  });

  it('shows the fixed limits and never offers live execution in Phase 1', () => {
    render(<MemoryRouter><LiveTradingShadowPage /></MemoryRouter>);
    expect(screen.getByText('资金池 ¥7,000')).toBeInTheDocument();
    expect(screen.getByText('最大投入 ¥5,600')).toBeInTheDocument();
    expect(screen.getByText('影子订单 0 / 20')).toBeInTheDocument();
    expect(screen.getByText('影子模式不会向券商提交订单')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '开启实盘' })).not.toBeInTheDocument();
  });

  it('blocks shadow submission when the local bridge is offline', () => {
    mocks.hook.mockReturnValue(hook({
      bridgeStatus: { state: 'failed', port: 8765, lastError: 'offline' },
      candidates: [candidate()],
    }));
    render(<MemoryRouter><LiveTradingShadowPage /></MemoryRouter>);
    expect(screen.getByText('本地交易桥离线')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成影子订单 Midea' })).toBeDisabled();
  });

  it('shows candidate ratings, price levels, and freshness', () => {
    mocks.hook.mockReturnValue(hook({ candidates: [candidate()] }));
    render(<MemoryRouter><LiveTradingShadowPage /></MemoryRouter>);
    expect(screen.getByText('Midea (000333)')).toBeInTheDocument();
    expect(screen.getByText('综合评分 76.8')).toBeInTheDocument();
    expect(screen.getByText('正式买入价 ¥9.90')).toBeInTheDocument();
    expect(screen.getByText('止损价 ¥9.40')).toBeInTheDocument();
    expect(screen.getByText('数据有效')).toBeInTheDocument();
  });
});
