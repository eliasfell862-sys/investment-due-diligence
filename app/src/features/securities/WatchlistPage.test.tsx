import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { MediumTermBuyAdvice } from '../../engines/market-analysis/medium-term-buy-advice';
import { WatchlistPage } from './WatchlistPage';

const mocks = vi.hoisted(() => ({
  fetchSinaQuotes: vi.fn(),
  loadStockDirectory: vi.fn().mockResolvedValue([]),
  analyzeWatchlistQuotes: vi.fn(),
  analyzeWatchlistStock: vi.fn(),
  clearWatchlistAdviceCache: vi.fn(),
}));

vi.mock('../../infrastructure/market-data/stock-api', () => ({
  fetchSinaQuotes: mocks.fetchSinaQuotes,
  loadStockDirectory: mocks.loadStockDirectory,
  fetchEastmoneyKLine: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../engines/market-analysis/technical-indicators', () => ({ calcAllIndicators: vi.fn() }));
vi.mock('../../engines/market-analysis/kline-patterns', () => ({ scanPatterns: vi.fn().mockReturnValue([]) }));

vi.mock('./watchlist-buy-advice-service', () => ({
  analyzeWatchlistQuotes: mocks.analyzeWatchlistQuotes,
  analyzeWatchlistStock: mocks.analyzeWatchlistStock,
  clearWatchlistAdviceCache: mocks.clearWatchlistAdviceCache,
}));

const stock = {
  code: '000001', name: '平安银行', market: 'sz' as const, price: 12, change: 0.2, changePct: 1.7,
  open: 11.8, high: 12.2, low: 11.7, volume: 1_000_000, amount: 120_000_000,
  preClose: 11.8, turnover: 3, pe: 14, pb: 1.4, totalShares: 100, floatShares: 80,
  totalCap: 800, floatCap: 640,
};

function advice(): MediumTermBuyAdvice {
  return {
    code: '000001', horizon: '1_3_months', action: 'accumulate', label: '分批买入', score: 82,
    confidence: 90, confidenceLabel: '高', reasons: ['趋势向上'], risks: ['估值波动'],
    dataCompleteness: { quote: true, kline: true, fundamental: true },
    calculatedAt: '2026-08-04T10:00:00.000Z',
  };
}

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderWatchlist() {
  return render(
    <MemoryRouter initialEntries={['/projects/default/securities/watchlist']}>
      <Routes>
        <Route path="/projects/:projectId/securities/*" element={<><WatchlistPage /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('WatchlistPage buy advice integration', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('sec_watchlists_v2', JSON.stringify([{
      id: 'default', name: '测试股池', codes: ['000001'], createdAt: '2026-08-04', groups: [], codeGroups: {},
    }]));
    localStorage.setItem('sec_active_watchlist', 'default');
    mocks.fetchSinaQuotes.mockReset().mockResolvedValue([stock]);
    mocks.clearWatchlistAdviceCache.mockReset();
    mocks.analyzeWatchlistStock.mockReset().mockResolvedValue(advice());
    mocks.analyzeWatchlistQuotes.mockReset().mockImplementation(async (quotes, options) => {
      options.onUpdate(quotes[0].code, { status: 'loading' });
      options.onUpdate(quotes[0].code, { status: 'success', advice: advice() });
    });
  });

  it('automatically analyzes quotes and renders progress and advice', async () => {
    renderWatchlist();
    expect(await screen.findByRole('columnheader', { name: '中线建议' })).toBeInTheDocument();
    expect(await screen.findByText('分批买入')).toBeInTheDocument();
    expect(screen.getByText('中线建议分析：1 / 1')).toBeInTheDocument();
    expect(mocks.analyzeWatchlistQuotes).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ code: '000001' })]),
      expect.objectContaining({ force: false, onUpdate: expect.any(Function), shouldPublish: expect.any(Function) }),
    );
  });

  it('refreshes all advice while keeping existing results visible', async () => {
    const user = userEvent.setup();
    renderWatchlist();
    await screen.findByText('分批买入');
    await user.click(screen.getByRole('button', { name: '刷新全部建议' }));
    expect(mocks.clearWatchlistAdviceCache).toHaveBeenCalledWith(['000001']);
    expect(mocks.analyzeWatchlistQuotes).toHaveBeenLastCalledWith(expect.any(Array), expect.objectContaining({ force: true }));
    expect(screen.getByText('分批买入')).toBeInTheDocument();
  });

  it('clicking advice expands locally without navigating', async () => {
    const user = userEvent.setup();
    renderWatchlist();
    await user.click(await screen.findByRole('button', { name: '查看平安银行中线建议' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/default/securities/watchlist');
    expect(screen.getByText('主要依据')).toBeInTheDocument();
  });

  it('clicking the stock row still navigates to the original analysis route', async () => {
    const user = userEvent.setup();
    renderWatchlist();
    await user.click(await screen.findByText('平安银行'));
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/default/securities/stock/000001');
  });

  it('retries only the failed stock', async () => {
    mocks.analyzeWatchlistQuotes.mockImplementationOnce(async (quotes, options) => {
      options.onUpdate(quotes[0].code, { status: 'error', error: 'network' });
    });
    const user = userEvent.setup();
    renderWatchlist();
    await user.click(await screen.findByRole('button', { name: '重试平安银行建议' }));
    expect(mocks.analyzeWatchlistStock).toHaveBeenCalledWith(expect.objectContaining({ code: '000001' }), { force: true });
    await waitFor(() => expect(screen.getByText('分批买入')).toBeInTheDocument());
  });
});
