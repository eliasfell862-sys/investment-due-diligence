import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { StockQuote } from '../../infrastructure/market-data/stock-api';

const realtime = vi.hoisted(() => ({
  current: null as any,
  refreshNow: vi.fn().mockResolvedValue(undefined),
  auth: null as any,
  loadCloudWatchlists: vi.fn(),
  saveCloudWatchlists: vi.fn(),
}));

vi.mock('./useRealtimeStockQuotes', () => ({
  useRealtimeStockQuotes: vi.fn(() => realtime.current),
}));

vi.mock('../auth/AuthProvider', () => ({
  useOptionalAuth: () => realtime.auth,
}));

vi.mock('./cloud/cloud-securities-repository', () => ({
  createCloudSecuritiesRepository: () => ({
    loadWatchlists: realtime.loadCloudWatchlists,
    saveWatchlists: realtime.saveCloudWatchlists,
  }),
}));

vi.mock('../../infrastructure/market-data/stock-api', () => ({
  fetchEastmoneyKLine: vi.fn().mockResolvedValue(
    Array.from({ length: 61 }, (_, index) => ({
      date: `2026-06-${String(index + 1).padStart(2, '0')}`,
      open: 10,
      close: 10.1,
      high: 10.3,
      low: 9.8,
      volume: 1000,
      amount: 10_000,
    })),
  ),
  fetchEastmoneyBasic: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../engines/market-analysis/technical-indicators', () => ({
  calcAllIndicators: vi.fn(),
}));

vi.mock('../../engines/market-analysis/backtest-engine', () => ({
  runBacktest: vi.fn(() => ({ totalTrades: 2 })),
}));

vi.mock('../../engines/market-analysis/fundamental-scorer', () => ({
  scoreFundamentals: vi.fn(() => ({ rating: 'B', totalScore: 70, dimensions: [] })),
}));

vi.mock('../../engines/market-analysis/trading-strategies', () => ({
  scanStrategies: vi.fn(() => []),
}));

vi.mock('../../engines/market-analysis/kline-patterns', () => ({
  scanPatterns: vi.fn(() => []),
}));

vi.mock('../../infrastructure/market-data/capital-flow-api', () => ({
  fetchStockFundFlow: vi.fn().mockResolvedValue(null),
  fmtFundFlow: vi.fn(() => '—'),
  flowColor: vi.fn(() => '#999'),
}));

vi.mock('../../engines/market-analysis/multi-agent-debate', () => ({
  runMultiAgentDebate: vi.fn(),
}));

vi.mock('../../engines/market-analysis/deep-research-engine', () => ({
  runDeepResearch: vi.fn(),
}));

import { runBacktest } from '../../engines/market-analysis/backtest-engine';
import { scoreFundamentals } from '../../engines/market-analysis/fundamental-scorer';
import { StockAnalysisPage } from './StockAnalysisPage';

function quote(price: number): StockQuote {
  return {
    code: '000001',
    name: 'Test Stock',
    market: 'sz',
    price,
    change: price - 12,
    changePct: (price - 12) / 12 * 100,
    open: 12,
    high: price,
    low: 11.8,
    volume: 100,
    amount: 1000,
    preClose: 12,
    turnover: 1,
    pe: 10,
    pb: 1,
    totalShares: 1,
    floatShares: 1,
    totalCap: 100,
    floatCap: 80,
  };
}

function snapshot(currentQuote: StockQuote) {
  return {
    quotes: { [currentQuote.code]: currentQuote },
    refreshing: false,
    marketStatus: 'trading' as const,
    lastUpdatedAt: '2026-08-04T02:00:00.000Z',
    stale: false,
    error: '',
    refreshNow: realtime.refreshNow,
  };
}

function app() {
  return (
    <MemoryRouter initialEntries={['/projects/default/securities/stock/000001']}>
      <Routes>
        <Route path="/projects/:projectId/securities/stock/:code" element={<StockAnalysisPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('StockAnalysisPage realtime quotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    realtime.refreshNow.mockResolvedValue(undefined);
    realtime.current = snapshot(quote(12.34));
    realtime.auth = null;
    realtime.loadCloudWatchlists.mockResolvedValue([]);
    realtime.saveCloudWatchlists.mockResolvedValue(undefined);
  });

  it('renders the live quote and exposes local manual refresh', async () => {
    render(app());
    expect((await screen.findAllByText('12.34')).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: '立即刷新' }));
    expect(realtime.refreshNow).toHaveBeenCalledOnce();
  });

  it('adds the analyzed stock to the authenticated cloud watchlist', async () => {
    realtime.auth = { cloudEnabled: true, user: { id: 'user-a' }, loading: false };
    realtime.loadCloudWatchlists.mockResolvedValue([{
      id: 'cloud-default', name: '默认自选', createdAt: '2026-08-01',
      codes: ['600519'], groups: [], codeGroups: {},
    }]);
    localStorage.setItem('sec_active_watchlist', 'cloud-default');

    render(app());
    await userEvent.click(await screen.findByRole('button', { name: /加入自选/ }));

    await waitFor(() => expect(realtime.saveCloudWatchlists).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'cloud-default', codes: ['000001', '600519'] }),
    ]));
    expect(screen.getByRole('button', { name: /已加入自选/ })).toBeInTheDocument();
  });

  it('keeps the selected tab and analytical snapshot when only the live price changes', async () => {
    const view = render(app());
    const klineTab = await screen.findByRole('button', { name: /K线与指标/ });
    await userEvent.click(klineTab);
    await waitFor(() => expect(scoreFundamentals).toHaveBeenCalled());
    const scoreCalls = vi.mocked(scoreFundamentals).mock.calls.length;
    const backtestCalls = vi.mocked(runBacktest).mock.calls.length;

    realtime.current = snapshot(quote(12.5));
    view.rerender(app());

    expect((await screen.findAllByText('12.50')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /K线与指标/ })).toHaveStyle({ background: '#1a3a3a' });
    expect(scoreFundamentals).toHaveBeenCalledTimes(scoreCalls);
    expect(runBacktest).toHaveBeenCalledTimes(backtestCalls);
  });
});
