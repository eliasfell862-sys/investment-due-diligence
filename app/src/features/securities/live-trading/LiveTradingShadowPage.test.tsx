import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EastmoneyOcrAccountSnapshot, LiveTradingCandidate } from './live-trading-types';

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

function account(overrides: Partial<EastmoneyOcrAccountSnapshot> = {}): EastmoneyOcrAccountSnapshot {
  return {
    mode: 'eastmoney_read_only',
    source: 'eastmoney_windows_ocr',
    available: true,
    capturedAt: '2026-08-17T02:30:00Z',
    quality: 'verification_required',
    verificationRequired: true,
    availableCash: 1234.56,
    totalAssets: 7000,
    positions: [{ code: '000333', totalShares: 300, availableShares: 200 }],
    failureReason: null,
    ...overrides,
  };
}

function hook(overrides: Record<string, unknown> = {}) {
  return {
    bridgeStatus: { state: 'ready', port: 8765, lastError: null },
    probeReport: null, candidates: [], orders: [], reservedTBuybackCash: 0,
    validShadowOrders: 0, blockingFailures: 0, analyzing: false, error: '',
    scanCandidates: vi.fn(), runProbe: vi.fn(), submitCandidate: vi.fn(),
    accountDraft: null, confirmedAccount: null, accountReading: false, accountError: '',
    readEastmoneyAccount: vi.fn(), confirmEastmoneyAccount: vi.fn(), clearEastmoneyAccount: vi.fn(),
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

  it('shows missing qualification scenarios without exposing a live switch', () => {
    mocks.hook.mockReturnValue(hook({
      missingScenarios: ['hard_stop', 't_buyback'],
      qualificationPassed: false,
      probeReady: true,
    }));
    render(<MemoryRouter><LiveTradingShadowPage /></MemoryRouter>);
    expect(screen.getByText('尚未具备实盘资格')).toBeInTheDocument();
    expect(screen.getByText(/hard_stop/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '开启实盘' })).not.toBeInTheDocument();
  });

  it('disables account OCR reading while the local bridge is offline', () => {
    mocks.hook.mockReturnValue(hook({
      bridgeStatus: { state: 'failed', port: 8765, lastError: 'offline' },
    }));
    render(<MemoryRouter><LiveTradingShadowPage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: '\u8bfb\u53d6\u4e1c\u65b9\u8d22\u5bcc\u8d26\u6237' })).toBeDisabled();
  });

  it('shows an unconfirmed OCR snapshot and requires explicit confirmation', async () => {
    const user = userEvent.setup();
    const confirmEastmoneyAccount = vi.fn();
    const clearEastmoneyAccount = vi.fn();
    mocks.hook.mockReturnValue(hook({
      accountDraft: account(), confirmEastmoneyAccount, clearEastmoneyAccount,
    }));
    render(<MemoryRouter><LiveTradingShadowPage /></MemoryRouter>);

    expect(screen.getByText('\u5f85\u4eba\u5de5\u786e\u8ba4')).toBeInTheDocument();
    expect(screen.getByText('\u53ef\u7528\u8d44\u91d1 \u00a51,234.56')).toBeInTheDocument();
    expect(screen.getByText('\u603b\u8d44\u4ea7 \u00a57,000')).toBeInTheDocument();
    expect(screen.getByText('000333')).toBeInTheDocument();
    expect(screen.getByText('300 / 200')).toBeInTheDocument();
    expect(screen.getByText(new RegExp('OCR \u7ed3\u679c\u5fc5\u987b\u4eba\u5de5\u590d\u6838'))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '\u786e\u8ba4\u8d26\u6237\u5feb\u7167' }));
    expect(confirmEastmoneyAccount).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '\u6e05\u9664\u8d26\u6237\u5feb\u7167' }));
    expect(clearEastmoneyAccount).toHaveBeenCalledTimes(1);
  });

  it('refreshes by replacing the visible draft instead of retaining stale values', async () => {
    const user = userEvent.setup();
    const readEastmoneyAccount = vi.fn();
    mocks.hook.mockReturnValue(hook({ accountDraft: account(), readEastmoneyAccount }));
    const view = render(<MemoryRouter><LiveTradingShadowPage /></MemoryRouter>);

    await user.click(screen.getByRole('button', { name: '\u5237\u65b0\u4e1c\u65b9\u8d22\u5bcc\u8d26\u6237' }));
    expect(readEastmoneyAccount).toHaveBeenCalledTimes(1);

    mocks.hook.mockReturnValue(hook({
      accountDraft: account({ availableCash: 900, positions: [{ code: '600519', totalShares: 100, availableShares: 100 }] }),
      readEastmoneyAccount,
    }));
    view.rerender(<MemoryRouter><LiveTradingShadowPage /></MemoryRouter>);
    expect(screen.queryByText('000333')).not.toBeInTheDocument();
    expect(screen.getByText('600519')).toBeInTheDocument();
    expect(screen.getByText('\u53ef\u7528\u8d44\u91d1 \u00a5900')).toBeInTheDocument();
  });

  it('shows a read failure without retaining a stale account draft', () => {
    mocks.hook.mockReturnValue(hook({
      accountDraft: null, accountError: 'trading_window_minimized',
    }));
    render(<MemoryRouter><LiveTradingShadowPage /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('trading_window_minimized');
    expect(screen.queryByText('000333')).not.toBeInTheDocument();
  });

  it('shows confirmed status but still never exposes a live execution switch', () => {
    mocks.hook.mockReturnValue(hook({ confirmedAccount: account({ verificationRequired: false }) }));
    render(<MemoryRouter><LiveTradingShadowPage /></MemoryRouter>);
    expect(screen.getByText('\u5df2\u786e\u8ba4\u7528\u4e8e\u5f71\u5b50\u98ce\u63a7')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '\u5f00\u542f\u5b9e\u76d8' })).not.toBeInTheDocument();
  });
});
