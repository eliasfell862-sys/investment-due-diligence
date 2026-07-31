import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../infrastructure/market-data/stock-api', () => ({
  fetchSinaQuotes: vi.fn().mockResolvedValue([]),
  fetchEastmoneyKLine: vi.fn().mockResolvedValue([]),
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
import { SecuritiesWorkbenchPage } from './SecuritiesWorkbenchPage';

describe('SecuritiesWorkbenchPage', () => {
  it('renders an independent securities workbench shell', () => {
    render(<SecuritiesWorkbenchPage />);

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
    render(<SecuritiesWorkbenchPage />);

    for (const label of ['基金', '债券', 'ETF', '股票']) {
      const button = screen.getByRole('button', { name: new RegExp(label) });
      await user.click(button);
      expect(button).toHaveAttribute('aria-current', 'page');
    }
  });

  it('loads the complete A-share directory and searches stocks outside the default watchlist', async () => {
    const user = userEvent.setup();
    render(<SecuritiesWorkbenchPage />);

    expect(await screen.findByText('已加载 3 只A股')).toBeInTheDocument();

    const search = screen.getByPlaceholderText(/搜索全部A股/);
    await user.type(search, '中芯');

    expect(await screen.findByText('中芯国际')).toBeInTheDocument();
    expect(screen.getByText('688981')).toBeInTheDocument();
  });
});
