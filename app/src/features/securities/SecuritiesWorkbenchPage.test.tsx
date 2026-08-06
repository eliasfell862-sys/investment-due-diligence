import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const mockedRealtimeHook = vi.hoisted(() => vi.fn());

vi.mock('./useRealtimeStockQuotes', () => ({
  useRealtimeStockQuotes: mockedRealtimeHook,
}));

vi.mock('./SignalInbox', () => ({
  SignalInbox: () => null,
}));

vi.mock('../../infrastructure/market-data/stock-api', () => ({
  fetchSinaQuotes: vi.fn().mockResolvedValue([]),
  fetchEastmoneyKLine: vi.fn().mockResolvedValue([]),
  loadStockDirectoryResult: vi.fn().mockResolvedValue({
    data: [
      { code: '000001', name: '平安银行', industry: '银行', classificationStatus: 'official' },
      { code: '600519', name: '贵州茅台', industry: '酿酒行业', classificationStatus: 'inferred' },
      { code: '688981', name: '中芯国际', industry: '未分类', classificationStatus: 'unclassified' },
    ],
    meta: {
      source: 'Local directory (inferred classification)', mode: 'cached', status: 'partial',
      asOf: '2026-08-03T10:00:00.000Z', error: 'Official classification unavailable: network blocked',
    },
  }),  loadStockDirectory: vi.fn().mockResolvedValue([
    { code: '000001', name: '平安银行', industry: '银行', classificationStatus: 'official' },
    { code: '600519', name: '贵州茅台', industry: '酿酒行业', classificationStatus: 'inferred' },
    { code: '688981', name: '中芯国际', industry: '未分类', classificationStatus: 'unclassified' },
  ]),
  fetchAllAStocks: vi.fn().mockResolvedValue([
    { code: '000001', name: '平安银行', industry: '银行', classificationStatus: 'official' },
    { code: '600519', name: '贵州茅台', industry: '酿酒行业', classificationStatus: 'inferred' },
    { code: '688981', name: '中芯国际', industry: '未分类', classificationStatus: 'unclassified' },
  ]),
  getOfficialIndustries: (stocks: Array<{ industry: string; classificationStatus?: string }>) =>
    [...new Set(stocks.filter(stock => stock.classificationStatus === 'official').map(stock => stock.industry))].sort(),
  filterAStocks: (stocks: Array<{ code: string; name: string; industry: string }>, keyword: string, industry: string) =>
    stocks.filter((stock) => {
      if (industry && stock.industry !== industry) return false;
      if (!keyword) return Boolean(industry);
      return stock.code.includes(keyword) || stock.name.includes(keyword);
    }),
}));
vi.mock('../../infrastructure/market-data/fund-api', () => ({
  fetchFundValuationsResult: vi.fn().mockResolvedValue({
    data: [{
      code: '110022', name: 'Test Fund', nav: 1, accNav: 1.1,
      estimatedNav: 1.01, estimatedChange: 1, navDate: '2026-08-03',
      valuationTime: '2026-08-03 10:00:00', type: 'equity',
    }],
    meta: { source: '腾讯基金行情', mode: 'realtime', status: 'success', asOf: '2026-08-03T10:00:00.000Z' },
  }),
  fetchFundValuations: vi.fn().mockResolvedValue([{
    code: '110022', name: 'Test Fund', nav: 1, accNav: 1.1,
    estimatedNav: 1.01, estimatedChange: 1, navDate: '2026-08-03',
    valuationTime: '2026-08-03 10:00:00', type: 'equity',
  }]),
  searchFunds: vi.fn().mockResolvedValue([]),
  fetchFundHoldings: vi.fn().mockResolvedValue([]),
  fetchFundNAVHistory: vi.fn().mockResolvedValue([]),
  fetchTencentQuotes: vi.fn().mockResolvedValue({}),
  addTransaction: vi.fn(),
  loadPositions: vi.fn().mockReturnValue([]),
  loadTransactions: vi.fn().mockReturnValue([]),
}));

vi.mock('../../infrastructure/market-data/bond-api', () => ({
  fetchConvertibleBondsResult: vi.fn().mockResolvedValue({
    data: [{
      code: '123111', name: 'Test Bond', price: 123.45, changePct: 1.25,
      volume: 1000, convertPrice: null, premium: null, stockPrice: null,
      stockChangePct: null, yieldToMaturity: null,
    }],
    meta: { source: '腾讯可转债行情', mode: 'realtime', status: 'success', asOf: '2026-08-03T10:00:00.000Z' },
  }),
  fetchConvertibleBonds: vi.fn().mockResolvedValue([{
    code: '123111', name: 'Test Bond', price: 123.45, changePct: 1.25,
    volume: 1000, convertPrice: null, premium: null, stockPrice: null,
    stockChangePct: null, yieldToMaturity: null,
  }]),
  fetchTreasuryYieldCurve: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../infrastructure/market-data/etf-api', () => ({
  fetchAStockETFsResult: vi.fn().mockResolvedValue({
    data: [{
      code: '510300', name: 'Test ETF', price: 0, changePct: 0, volume: 0,
      fundSize: 100, category: 'index', underlying: 'CSI 300',
      issuer: 'Test', expenseRatio: 0, premium: 0,
    }],
    meta: { source: '本地 ETF 目录', mode: 'static', status: 'success', asOf: '2026-08-03T10:00:00.000Z' },
  }),
  fetchAStockETFs: vi.fn().mockResolvedValue([{
    code: '510300', name: 'Test ETF', price: 0, changePct: 0, volume: 0,
    fundSize: 100, category: 'index', underlying: 'CSI 300',
    issuer: 'Test', expenseRatio: 0, premium: 0,
  }]),
  fetchGlobalETFs: vi.fn().mockReturnValue([]),
  fetchGlobalETFQuotes: vi.fn().mockResolvedValue([]),
  mergeGlobalETFQuotes: vi.fn().mockImplementation((list) => list),
}));
import { FundDetailPanel, SecuritiesWorkbenchPage } from './SecuritiesWorkbenchPage';
import { fetchFundHoldings, fetchFundValuationsResult, fetchTencentQuotes } from '../../infrastructure/market-data/fund-api';
import { fetchConvertibleBondsResult } from '../../infrastructure/market-data/bond-api';
import { fetchAStockETFsResult } from '../../infrastructure/market-data/etf-api';

describe('SecuritiesWorkbenchPage', () => {
  beforeEach(() => {
    mockedRealtimeHook.mockReturnValue({
      quotes: {}, refreshing: false, marketStatus: 'trading',
      lastUpdatedAt: '2026-08-04T02:00:00.000Z', stale: false, error: '',
      refreshNow: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('renders an independent securities workbench shell', () => {
    render(<MemoryRouter><SecuritiesWorkbenchPage /></MemoryRouter>);

    const heading = screen.getByRole('heading', { name: '证券项目工作台' });

    expect(heading).toBeInTheDocument();
    expect(heading.closest('.securities-workbench-page')).not.toBeNull();
    expect(
      screen.getByText('股票 · 基金 · 债券 · ETF 综合研究平台'),
    ).toBeInTheDocument();
    expect(screen.getByText('Securities / 证券研究')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '证券资产类别' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /策略学习实验室/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /启动预期雷达/ })).toBeInTheDocument();
    const stockButton = screen.getByRole('button', { name: /股票/ });
    expect(stockButton).toHaveAttribute('aria-current', 'page');
    expect(stockButton.getAttribute('style')).toContain('var(--sec-accent)');
    expect(document.querySelector('.securities-table-shell')).not.toBeNull();
    expect(screen.queryByText('新建投研项目')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '投研项目列表' })).not.toBeInTheDocument();
  });

  it('keeps the selected asset tab visually identifiable', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><SecuritiesWorkbenchPage /></MemoryRouter>);

    for (const label of ['基金', '债券', 'ETF', '股票']) {
      const button = screen.getByRole('button', { name: new RegExp(label) });
      await user.click(button);
      expect(button).toHaveAttribute('aria-current', 'page');
    }
  });

  it('loads the complete A-share directory and searches stocks outside the default watchlist', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><SecuritiesWorkbenchPage /></MemoryRouter>);

    expect(await screen.findByText('已加载 3 只A股')).toBeInTheDocument();

    const search = screen.getByPlaceholderText(/搜索全部A股/);
    await user.type(search, '中芯');

    expect(await screen.findByText('中芯国际')).toBeInTheDocument();
    expect(screen.getByText('688981')).toBeInTheDocument();
  });
  it('keeps inferred industries out of the official industry filter and labels their evidence level', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><SecuritiesWorkbenchPage /></MemoryRouter>);

    expect(await screen.findByText('行业分类：正式 1 · 推断 1 · 未分类 1')).toBeInTheDocument();
    const industryFilter = screen.getByRole('combobox');
    expect(within(industryFilter).getByRole('option', { name: '银行' })).toBeInTheDocument();
    expect(within(industryFilter).queryByRole('option', { name: '酿酒行业' })).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/搜索全部A股/), '茅台');
    expect(await screen.findByText('系统推断')).toBeInTheDocument();
  });

  it('renders stock watchlist prices from the shared realtime Hook', async () => {
    mockedRealtimeHook.mockReturnValue({
      quotes: { '000001': { code: '000001', name: 'AutoStock', market: 'sz', price: 12.34, change: 0.34, changePct: 2.83, open: 12, high: 12.5, low: 11.8, volume: 100, amount: 1000, preClose: 12, turnover: 1, pe: 10, pb: 1, totalShares: 1, floatShares: 1, totalCap: 100, floatCap: 80 } },
      refreshing: false, marketStatus: 'trading', lastUpdatedAt: '2026-08-04T02:00:00.000Z', stale: false, error: '', refreshNow: vi.fn(),
    });
    render(<MemoryRouter><SecuritiesWorkbenchPage /></MemoryRouter>);
    expect((await screen.findAllByText('12.34')).length).toBeGreaterThan(0);
    expect(await screen.findByRole('heading', { name: 'AutoStock (000001)' })).toBeInTheDocument();
    expect(mockedRealtimeHook).toHaveBeenCalledWith(expect.arrayContaining(['000001']));
  });

  it('uses the shared manual refresh control', async () => {
    const refreshNow = vi.fn().mockResolvedValue(undefined);
    mockedRealtimeHook.mockReturnValue({
      quotes: {}, refreshing: false, marketStatus: 'trading', lastUpdatedAt: null,
      stale: false, error: '', refreshNow,
    });
    render(<MemoryRouter><SecuritiesWorkbenchPage /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: '立即刷新' }));
    expect(refreshNow).toHaveBeenCalledOnce();
  });

  it('uses shared realtime quotes for fund holding prices', async () => {
    vi.mocked(fetchFundHoldings).mockResolvedValueOnce([
      { stockCode: '000001', stockName: 'Holding Stock', ratio: 8.5, price: 0, change: 0 },
    ]);
    mockedRealtimeHook.mockReturnValue({
      quotes: { '000001': { code: '000001', name: 'Holding Stock', market: 'sz', price: 12.34, change: 0.34, changePct: 2.83, open: 12, high: 12.5, low: 11.8, volume: 100, amount: 1000, preClose: 12, turnover: 1, pe: 10, pb: 1, totalShares: 1, floatShares: 1, totalCap: 100, floatCap: 80 } },
      refreshing: false, marketStatus: 'trading', lastUpdatedAt: '2026-08-04T02:00:00.000Z', stale: false, error: '', refreshNow: vi.fn(),
    });

    function FundHarness() {
      const [tab, setTab] = useState('overview');
      return <FundDetailPanel fund={{ code: '110022', name: 'Test Fund', nav: 1, accNav: 1.1, estimatedNav: 1.01, estimatedChange: 1, navDate: '2026-08-03', valuationTime: '', type: 'equity' }} activeTab={tab} setActiveTab={setTab} />;
    }

    render(<FundHarness />);
    await userEvent.click(await screen.findByRole('button', { name: /持仓 \(1\)/ }));
    expect(await screen.findByText('12.34')).toBeInTheDocument();
    expect(screen.getByText('+2.83%')).toBeInTheDocument();
    expect(fetchTencentQuotes).not.toHaveBeenCalled();
  });
  it('shows unavailable convertible-bond derived fields as missing', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><SecuritiesWorkbenchPage /></MemoryRouter>);

    await user.click(screen.getByRole('button', { name: /债券/ }));
    const nameCell = await screen.findByText('Test Bond');
    const cells = within(nameCell.closest('tr')!).getAllByRole('cell');

    expect(cells[4]).toHaveTextContent('—');
    expect(cells[5]).toHaveTextContent('—');
    expect(cells[6]).toHaveTextContent('—');
    expect(cells[7]).toHaveTextContent('—');
    expect(cells[8]).toHaveTextContent('—');
  });

  it('shows a degraded directory as partially available instead of successful', async () => {
    render(<MemoryRouter><SecuritiesWorkbenchPage /></MemoryRouter>);

    expect(await screen.findByText('部分可用')).toBeInTheDocument();
    expect(screen.getByTitle(/Official classification unavailable/)).toBeInTheDocument();
  });

  it('shows source and freshness metadata for fund, bond and ETF data', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><SecuritiesWorkbenchPage /></MemoryRouter>);

    expect(await screen.findByText(/腾讯股票行情/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /基金/ }));
    expect(await screen.findByText(/腾讯基金行情/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /债券/ }));
    expect(await screen.findByText(/腾讯可转债行情/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /ETF/ }));
    expect(await screen.findByText(/本地 ETF 目录/)).toBeInTheDocument();
  });

  it('shows fund data as not requested when the fund list is empty', async () => {
    localStorage.setItem('fund_watchlist', '[]');
    const user = userEvent.setup();
    render(<MemoryRouter><SecuritiesWorkbenchPage /></MemoryRouter>);

    await user.click(screen.getByRole('button', { name: /基金/ }));

    expect(await screen.findByText('未请求')).toBeInTheDocument();
  });

  it('uses provider metadata for fund, bond and ETF availability', async () => {
    localStorage.setItem('fund_watchlist', '["110022","000001"]');
    vi.mocked(fetchFundValuationsResult).mockResolvedValueOnce({
      data: [{
        code: '110022', name: 'Partial Fund', nav: 1, accNav: 1.1,
        estimatedNav: 1.01, estimatedChange: 1, navDate: '2026-08-03',
        valuationTime: '', type: 'equity',
      }],
      meta: {
        source: 'Tencent fund quotes', mode: 'realtime', status: 'partial',
        asOf: '2026-08-03T10:00:00.000Z', error: 'one requested fund was missing',
      },
    });
    vi.mocked(fetchConvertibleBondsResult).mockResolvedValueOnce({
      data: [],
      meta: {
        source: 'Tencent convertible bond quotes', mode: 'realtime',
        status: 'error', error: 'bond service unavailable',
      },
    });
    vi.mocked(fetchAStockETFsResult).mockResolvedValueOnce({
      data: [],
      meta: {
        source: 'Local A-share ETF directory', mode: 'static',
        status: 'error', error: 'ETF file unavailable',
      },
    });

    const user = userEvent.setup();
    render(<MemoryRouter><SecuritiesWorkbenchPage /></MemoryRouter>);

    await user.click(screen.getByRole('button', { name: /基金/ }));
    expect(await screen.findByText('部分可用')).toBeInTheDocument();
    expect(screen.getByTitle('one requested fund was missing')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /债券/ }));
    expect(await screen.findByTitle('bond service unavailable')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /ETF/ }));
    expect(await screen.findByTitle('ETF file unavailable')).toBeInTheDocument();
  });});
