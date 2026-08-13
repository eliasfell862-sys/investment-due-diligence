import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { MediumTermBuyAdvice } from '../../engines/market-analysis/medium-term-buy-advice';
import type { ShortTermTradingAdvice } from '../../engines/market-analysis/short-term-trading-advice';
import { WatchlistPage } from './WatchlistPage';
import { writeCachedWatchlists } from './securities-account-cache';
import { STOCK_POSITION_LEDGER_CHANGED_EVENT, STOCK_POSITION_LEDGER_KEY } from './stock-position-ledger';
import { SecuritiesStateProvider } from './state/SecuritiesStateProvider';

const mocks = vi.hoisted(() => ({
  realtimeHook: vi.fn(),
  refreshNow: vi.fn(),
  loadStockDirectory: vi.fn().mockResolvedValue([]),
  analyzeWatchlistQuotes: vi.fn(),
  analyzeWatchlistStock: vi.fn(),
  clearWatchlistAdviceCache: vi.fn(),
  analyzeWatchlistShortTermQuotes: vi.fn(),
  analyzeWatchlistShortTermStock: vi.fn(),
  recalculateWatchlistShortTermStock: vi.fn(),
  clearWatchlistShortTermAdviceCache: vi.fn(),
  authState: { cloudEnabled: false, user: null as { id: string } | null },
  loadCloudWatchlists: vi.fn(),
  saveCloudWatchlists: vi.fn(),
  loadCloudPositionLedger: vi.fn(),
}));

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => mocks.authState,
  useOptionalAuth: () => mocks.authState,
}));

vi.mock('./cloud/cloud-securities-repository', () => ({
  createCloudSecuritiesRepository: () => ({
    loadWatchlists: mocks.loadCloudWatchlists,
    saveWatchlists: mocks.saveCloudWatchlists,
    loadPositionLedger: mocks.loadCloudPositionLedger,
  }),
}));

vi.mock('./useRealtimeStockQuotes', () => ({
  useRealtimeStockQuotes: mocks.realtimeHook,
}));

vi.mock('../../infrastructure/market-data/stock-api', () => ({
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

vi.mock('./watchlist-short-term-advice-service', () => ({
  analyzeWatchlistShortTermQuotes: mocks.analyzeWatchlistShortTermQuotes,
  analyzeWatchlistShortTermStock: mocks.analyzeWatchlistShortTermStock,
  recalculateWatchlistShortTermStock: mocks.recalculateWatchlistShortTermStock,
  clearWatchlistShortTermAdviceCache: mocks.clearWatchlistShortTermAdviceCache,
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

function shortTermAdvice(price = 12): ShortTermTradingAdvice {
  return {
    code: '000001', horizon: '3_10_trading_days', action: 'buy_on_dip', label: '逢低买入', score: 75,
    confidence: 82, confidenceLabel: '高', entryRange: { low: price - 0.2, high: price }, stopLoss: price - 0.8,
    takeProfit1: price + 1, takeProfit2: price + 1.5, maxHoldingTradingDays: 7, riskRewardRatio: 1.65,
    reasons: ['趋势向上'], risks: ['短线波动'],
    dataCompleteness: { quote: true, kline: true, indicators: true, strategies: true },
    dataAsOf: '2026-08-04T10:00:00.000Z', calculatedAt: '2026-08-04T10:00:01.000Z', cacheStatus: 'fresh',
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
function renderWatchlistWithSharedState() {
  return render(
    <SecuritiesStateProvider>
      <MemoryRouter initialEntries={['/projects/default/securities/watchlist']}>
        <Routes>
          <Route path="/projects/:projectId/securities/*" element={<><WatchlistPage /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>
    </SecuritiesStateProvider>,
  );
}

describe('WatchlistPage buy advice integration', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.authState.cloudEnabled = false;
    mocks.authState.user = null;
    mocks.loadCloudWatchlists.mockReset().mockResolvedValue([]);
    mocks.saveCloudWatchlists.mockReset().mockResolvedValue(undefined);
    mocks.loadCloudPositionLedger.mockReset().mockResolvedValue({ version: 1, groups: [], positions: [], transactions: [] });
    localStorage.setItem('sec_watchlists_v2', JSON.stringify([{
      id: 'default', name: '测试股池', codes: ['000001'], createdAt: '2026-08-04', groups: [], codeGroups: {},
    }]));
    localStorage.setItem('sec_active_watchlist', 'default');
    mocks.refreshNow.mockReset().mockResolvedValue(undefined);
    mocks.realtimeHook.mockReset().mockReturnValue({
      quotes: { '000001': stock }, refreshing: false, marketStatus: 'trading',
      lastUpdatedAt: '2026-08-04T02:00:00.000Z', stale: false, error: '', refreshNow: mocks.refreshNow,
    });
    mocks.clearWatchlistAdviceCache.mockReset();
    mocks.clearWatchlistShortTermAdviceCache.mockReset();
    mocks.analyzeWatchlistStock.mockReset().mockResolvedValue(advice());
    mocks.analyzeWatchlistQuotes.mockReset().mockImplementation(async (quotes, options) => {
      options.onUpdate(quotes[0].code, { status: 'loading' });
      options.onUpdate(quotes[0].code, { status: 'success', advice: advice() });
    });
    mocks.analyzeWatchlistShortTermStock.mockReset().mockResolvedValue(shortTermAdvice());
    mocks.recalculateWatchlistShortTermStock.mockReset().mockResolvedValue(null);
    mocks.analyzeWatchlistShortTermQuotes.mockReset().mockImplementation(async (quotes, options) => {
      options.onUpdate(quotes[0].code, { status: 'loading' });
      options.onUpdate(quotes[0].code, { status: 'success', advice: shortTermAdvice(quotes[0].price) });
    });
  });

  it('shows the current-account cached watchlist before a slow cloud response', async () => {
    mocks.authState.cloudEnabled = true;
    mocks.authState.user = { id: 'user-1' };
    let resolveCloud!: (value: unknown[]) => void;
    mocks.loadCloudWatchlists.mockImplementation(() => new Promise(resolve => { resolveCloud = resolve; }));
    writeCachedWatchlists('user-1', [{
      id: 'cached-list', name: 'Cached list', codes: ['000001'], createdAt: '2026-08-12',
      groups: [], codeGroups: {},
    }]);

    renderWatchlist();
    expect(await screen.findByText('Cached list (1)')).toBeInTheDocument();

    resolveCloud([{ id: 'cloud-list', name: 'Cloud list', codes: ['000001'], createdAt: '2026-08-12', groups: [], codeGroups: {} }]);
    expect(await screen.findByText('Cloud list (1)')).toBeInTheDocument();
  });
  it('does not overwrite cloud watchlists when hydration fails', async () => {
    mocks.authState.cloudEnabled = true;
    mocks.authState.user = { id: 'user-1' };
    mocks.loadCloudWatchlists.mockRejectedValueOnce(new Error('cloud offline'));

    renderWatchlist();

    expect(await screen.findByRole('alert')).toHaveTextContent('cloud offline');
    expect(mocks.saveCloudWatchlists).not.toHaveBeenCalled();
  });

  it('does not immediately write the just-hydrated cloud snapshot back', async () => {
    mocks.authState.cloudEnabled = true;
    mocks.authState.user = { id: 'user-1' };
    mocks.loadCloudWatchlists.mockResolvedValueOnce([{
      id: 'cloud-list', name: 'Cloud list', codes: ['000001'], createdAt: '2026-08-10',
      groups: [], codeGroups: {},
    }]);

    renderWatchlist();

    expect(await screen.findByText('Cloud list (1)')).toBeInTheDocument();
    await waitFor(() => expect(mocks.loadCloudWatchlists).toHaveBeenCalledOnce());
    expect(mocks.saveCloudWatchlists).not.toHaveBeenCalled();
  });
  it('does not write an authoritative shared-state refresh back to the cloud', async () => {
    mocks.authState.cloudEnabled = true;
    mocks.authState.user = { id: 'user-1' };
    mocks.loadCloudWatchlists.mockResolvedValue([{
      id: 'cloud-list', name: 'Cloud list', codes: ['000001'], createdAt: '2026-08-10',
      groups: [], codeGroups: {},
    }]);

    renderWatchlistWithSharedState();

    expect(await screen.findByText('Cloud list (1)')).toBeInTheDocument();
    await waitFor(() => expect(mocks.loadCloudWatchlists).toHaveBeenCalledOnce());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mocks.saveCloudWatchlists).not.toHaveBeenCalled();
  });
  it('renders known watchlist codes before realtime quotes arrive', async () => {
    mocks.realtimeHook.mockReturnValue({
      quotes: {}, refreshing: true, marketStatus: 'trading', lastUpdatedAt: null,
      stale: false, error: '', refreshNow: mocks.refreshNow,
    });

    renderWatchlist();

    const row = await screen.findByRole('row', { name: /000001/ });
    expect(row).toHaveTextContent('行情加载中');
  });
  it('subscribes to the entire active pool and renders realtime prices', async () => {
    renderWatchlist();
    expect(mocks.realtimeHook).toHaveBeenCalledWith(['000001']);
    expect(await screen.findByText('12.00')).toBeInTheDocument();
  });

  it('keeps the entire pool subscribed while a tag filter is active', async () => {
    const second = { ...stock, code: '600519', name: '贵州茅台', market: 'sh' as const, price: 1500 };
    localStorage.setItem('sec_watchlists_v2', JSON.stringify([{
      id: 'default', name: '测试股池', codes: ['000001', '600519'], createdAt: '2026-08-04',
      groups: [{ id: 'g1', name: '价值投资', color: '#d4a574' }],
      codeGroups: { '000001': ['g1'], '600519': [] },
    }]));
    mocks.realtimeHook.mockReturnValue({
      quotes: { '000001': stock, '600519': second }, refreshing: false, marketStatus: 'trading',
      lastUpdatedAt: '2026-08-04T02:00:00.000Z', stale: false, error: '', refreshNow: mocks.refreshNow,
    });
    renderWatchlist();
    await userEvent.click(await screen.findByRole('button', { name: /价值投资/ }));
    expect(mocks.realtimeHook).toHaveBeenLastCalledWith(expect.arrayContaining(['000001', '600519']));
  });
  it('keeps advice analysis isolated from price-only refreshes', async () => {
    const view = renderWatchlist();
    await screen.findByText('分批买入');
    const initialCalls = mocks.analyzeWatchlistQuotes.mock.calls.length;
    mocks.realtimeHook.mockReturnValue({
      quotes: { '000001': { ...stock, price: 12.34 } }, refreshing: false, marketStatus: 'trading',
      lastUpdatedAt: '2026-08-04T02:00:03.000Z', stale: false, error: '', refreshNow: mocks.refreshNow,
    });
    view.rerender(
      <MemoryRouter initialEntries={['/projects/default/securities/watchlist']}>
        <Routes><Route path="/projects/:projectId/securities/*" element={<><WatchlistPage /><LocationProbe /></>} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('12.34')).toBeInTheDocument();
    expect(mocks.analyzeWatchlistQuotes).toHaveBeenCalledTimes(initialCalls);
  });

  it('refreshes quotes independently from advice', async () => {
    renderWatchlist();
    await screen.findByText('分批买入');
    const initialCalls = mocks.analyzeWatchlistQuotes.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: '立即刷新' }));
    expect(mocks.refreshNow).toHaveBeenCalledOnce();
    expect(mocks.analyzeWatchlistQuotes).toHaveBeenCalledTimes(initialCalls);
  });

  it('automatically analyzes quotes and renders progress and advice', async () => {
    renderWatchlist();
    expect(await screen.findByRole('columnheader', { name: '短线建议' })).toBeInTheDocument();
    expect(await screen.findByRole('columnheader', { name: '中线建议' })).toBeInTheDocument();
    expect(await screen.findByText('买入')).toBeInTheDocument();
    expect(await screen.findByText('分批买入')).toBeInTheDocument();
    expect(screen.getByText('短线建议分析：1 / 1')).toBeInTheDocument();
    expect(screen.getByText('中线建议分析：1 / 1')).toBeInTheDocument();
    expect(mocks.analyzeWatchlistQuotes).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ code: '000001' })]),
      expect.objectContaining({ force: false, onUpdate: expect.any(Function), shouldPublish: expect.any(Function) }),
    );
    expect(mocks.analyzeWatchlistShortTermQuotes).toHaveBeenCalledWith(
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
    expect(mocks.clearWatchlistShortTermAdviceCache).toHaveBeenCalledWith(['000001']);
    expect(mocks.analyzeWatchlistQuotes).toHaveBeenLastCalledWith(expect.any(Array), expect.objectContaining({ force: true }));
    expect(mocks.analyzeWatchlistShortTermQuotes).toHaveBeenLastCalledWith(expect.any(Array), expect.objectContaining({ force: true }));
    expect(screen.getByText('分批买入')).toBeInTheDocument();
  });

  it('clicking advice expands locally without navigating', async () => {
    const user = userEvent.setup();
    renderWatchlist();
    await user.click(await screen.findByRole('button', { name: '查看平安银行中线建议' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/default/securities/watchlist');
    expect(screen.getByText('主要依据')).toBeInTheDocument();
  });

  it('expands short-term advice without navigating', async () => {
    const user = userEvent.setup();
    renderWatchlist();
    await user.click(await screen.findByRole('button', { name: '查看平安银行短线建议' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/default/securities/watchlist');
    expect(screen.getByText(/第二止盈/)).toBeInTheDocument();
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

  it('buys from the watchlist without navigating and then shows the held state', async () => {
    const user = userEvent.setup();
    renderWatchlist();

    await user.click(await screen.findByRole('button', { name: '加入持仓 平安银行' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/default/securities/watchlist');
    expect(screen.getByLabelText('交易股数')).toHaveValue(100);
    expect(screen.getByLabelText('成交价格')).toHaveValue(12);
    await user.click(screen.getByRole('button', { name: '确认买入' }));

    expect(await screen.findByRole('button', { name: '已加入持仓 平安银行' })).toBeDisabled();
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/default/securities/watchlist');
  });

  it('renders higher combined advice scores first without changing the saved pool order', async () => {
    const highScoreStock = {
      ...stock,
      code: '600519',
      name: '贵州茅台',
      market: 'sh' as const,
      price: 1500,
    };
    localStorage.setItem('sec_watchlists_v2', JSON.stringify([{
      id: 'default', name: '测试股池', codes: ['000001', '600519'],
      createdAt: '2026-08-04', groups: [], codeGroups: {},
    }]));
    mocks.realtimeHook.mockReturnValue({
      quotes: { '000001': stock, '600519': highScoreStock },
      refreshing: false, marketStatus: 'trading',
      lastUpdatedAt: '2026-08-04T02:00:00.000Z', stale: false, error: '',
      refreshNow: mocks.refreshNow,
    });
    mocks.analyzeWatchlistQuotes.mockImplementation(async (quotes, options) => {
      for (const quote of quotes) {
        const high = quote.code === '600519';
        options.onUpdate(quote.code, {
          status: 'success',
          advice: {
            ...advice(),
            code: quote.code,
            score: high ? 90 : 40,
            action: high ? 'accumulate' : 'risk_avoidance',
            label: high ? '分批买入' : '风险回避',
          },
        });
      }
    });
    mocks.analyzeWatchlistShortTermQuotes.mockImplementation(async (quotes, options) => {
      for (const quote of quotes) {
        const high = quote.code === '600519';
        options.onUpdate(quote.code, {
          status: 'success',
          advice: {
            ...shortTermAdvice(quote.price),
            code: quote.code,
            score: high ? 80 : 40,
            action: high ? 'buy_on_dip' : 'avoid',
            label: high ? '逢低买入' : '暂不介入',
          },
        });
      }
    });

    renderWatchlist();

    await screen.findByText('贵州茅台');
    await waitFor(() => {
      const rows = screen.getAllByRole('row');
      expect(rows[1]).toHaveTextContent('600519');
      expect(rows[2]).toHaveTextContent('000001');
    });
    expect(JSON.parse(localStorage.getItem('sec_watchlists_v2')!)[0].codes)
      .toEqual(['000001', '600519']);
  });

  it('restores the add button after the position is fully removed from the ledger', async () => {
    localStorage.setItem(STOCK_POSITION_LEDGER_KEY, JSON.stringify({
      version: 1,
      groups: [{ id: 'default', name: '默认持仓' }],
      positions: [{
        id: 'position-1', groupId: 'default', code: '000001', name: '平安银行',
        shares: 100, averageCost: 12, totalCost: 1_200,
        openedAt: '2026-08-05T01:30:00.000Z', updatedAt: '2026-08-05T01:30:00.000Z',
        sourceAlertIds: ['manual-1'],
      }],
      transactions: [],
    }));
    renderWatchlist();
    expect(await screen.findByRole('button', { name: '已加入持仓 平安银行' })).toBeDisabled();

    localStorage.setItem(STOCK_POSITION_LEDGER_KEY, JSON.stringify({
      version: 1, groups: [{ id: 'default', name: '默认持仓' }],
      positions: [], transactions: [],
    }));
    window.dispatchEvent(new Event(STOCK_POSITION_LEDGER_CHANGED_EVENT));
    expect(await screen.findByRole('button', { name: '加入持仓 平安银行' })).toBeEnabled();
  });
});
