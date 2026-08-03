import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PortfolioAllocationPage } from './PortfolioAllocationPage';

vi.mock('../../infrastructure/market-data/stock-api', () => ({
  fetchSinaQuotes: vi.fn().mockResolvedValue([
    {
      code: '000001',
      name: '平安银行',
      price: 10,
      change: 0,
      changePct: 0,
      open: 10,
      high: 10,
      low: 10,
      preClose: 10,
      volume: 1000,
      amount: 10000,
      turnover: 1,
      pe: 8,
      pb: 1,
      totalCap: 2000,
    },
  ]),
  fetchEastmoneyKLine: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../engines/market-analysis/technical-indicators', () => ({
  calcAllIndicators: vi.fn(),
}));

vi.mock('../../engines/market-analysis/kline-patterns', () => ({
  scanPatterns: vi.fn().mockReturnValue([]),
}));

vi.mock('../../engines/market-analysis/trading-strategies', () => ({
  scanStrategies: vi.fn().mockReturnValue([]),
}));

function seedActiveWatchlist() {
  localStorage.setItem('sec_watchlists_v2', JSON.stringify([
    {
      id: 'wl-1',
      name: '核心池',
      codes: ['000001'],
      createdAt: '2026-08-03',
      groups: [],
      codeGroups: {},
    },
  ]));
  localStorage.setItem('sec_active_watchlist', 'wl-1');
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/projects/default/securities/portfolio']}>
      <PortfolioAllocationPage />
    </MemoryRouter>,
  );
}

describe('PortfolioAllocationPage portfolio groups', () => {
  beforeEach(() => {
    localStorage.clear();
    seedActiveWatchlist();
  });

  it('saves a new group without requiring an AI review', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.queryByRole('heading', { name: '保存到持仓组' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /开始分析/ }));

    expect(await screen.findByRole('heading', { name: '保存到持仓组' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('目标持仓组'), '__new__');
    await user.type(screen.getByLabelText('新持仓组名称'), '稳健组合');
    await user.click(screen.getByRole('button', { name: '保存当前方案' }));

    expect(await screen.findByText(/已保存到“稳健组合”/)).toBeInTheDocument();
    const saved = JSON.parse(localStorage.getItem('sec_portfolio_groups_v1') || '[]');
    expect(saved[0].versions[0]).toMatchObject({
      capital: 100000,
      aiSummary: '',
      sourceWatchlistId: 'wl-1',
      sourceWatchlistName: '核心池',
    });
  });
});
