import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../infrastructure/market-data/stock-api', () => ({
  fetchSinaQuotes: vi.fn().mockResolvedValue([]),
  fetchEastmoneyKLine: vi.fn().mockResolvedValue([]),
  loadStockDirectory: vi.fn().mockResolvedValue([
    { code: '000001', name: '平安银行', industry: '银行' },
    { code: '600519', name: '贵州茅台', industry: '酿酒行业' },
    { code: '688981', name: '中芯国际', industry: '半导体' },
  ]),
  fetchAllAStocks: vi.fn().mockResolvedValue([
    { code: '000001', name: '平安银行', industry: '银行' },
    { code: '600519', name: '贵州茅台', industry: '酿酒行业' },
    { code: '688981', name: '中芯国际', industry: '半导体' },
  ]),
  filterAStocks: (stocks: Array<{ code: string; name: string; industry: string }>, keyword: string, industry: string) =>
    stocks.filter((stock) => {
      if (industry && stock.industry !== industry) return false;
      if (!keyword) return Boolean(industry);
      return stock.code.includes(keyword) || stock.name.includes(keyword);
    }),
}));
vi.mock('../../infrastructure/market-data/fund-api', () => ({
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
  fetchConvertibleBonds: vi.fn().mockResolvedValue([{
    code: '123111', name: 'Test Bond', price: 123.45, changePct: 1.25,
    volume: 1000, convertPrice: null, premium: null, stockPrice: null,
    stockChangePct: null, yieldToMaturity: null,
  }]),
  fetchTreasuryYieldCurve: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../infrastructure/market-data/etf-api', () => ({
  fetchAStockETFs: vi.fn().mockResolvedValue([{
    code: '510300', name: 'Test ETF', price: 0, changePct: 0, volume: 0,
    fundSize: 100, category: 'index', underlying: 'CSI 300',
    issuer: 'Test', expenseRatio: 0, premium: 0,
  }]),
  fetchGlobalETFs: vi.fn().mockReturnValue([]),
  fetchGlobalETFQuotes: vi.fn().mockResolvedValue([]),
  mergeGlobalETFQuotes: vi.fn().mockImplementation((list) => list),
}));
import { SecuritiesWorkbenchPage } from './SecuritiesWorkbenchPage';
import { fetchSinaQuotes } from '../../infrastructure/market-data/stock-api';

describe('SecuritiesWorkbenchPage', () => {
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
  it('automatically restores the stock overview after quotes load', async () => {
    vi.mocked(fetchSinaQuotes).mockResolvedValue([{ code: '000001', name: 'AutoStock', market: 'sz', price: 10, change: 0, changePct: 0, open: 10, high: 10, low: 10, volume: 100, amount: 1000, preClose: 10, turnover: 1, pe: 10, pb: 1, totalShares: 1, floatShares: 1, totalCap: 100, floatCap: 80 }]);
    render(<MemoryRouter><SecuritiesWorkbenchPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'AutoStock (000001)' })).toBeInTheDocument();
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
});
