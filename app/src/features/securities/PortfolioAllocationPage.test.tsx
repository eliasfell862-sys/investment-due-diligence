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

  it('appends a new version when saving to an existing group', async () => {
    localStorage.setItem('sec_portfolio_groups_v1', JSON.stringify([
      {
        id: 'pg-existing',
        name: '稳健组合',
        createdAt: '2026-08-03T08:00:00.000Z',
        updatedAt: '2026-08-03T08:00:00.000Z',
        currentVersionId: 'pv-old',
        versions: [
          {
            id: 'pv-old',
            createdAt: '2026-08-03T08:00:00.000Z',
            capital: 50000,
            riskLevel: 'conservative',
            aiSummary: '',
            positions: [
              {
                code: '000001', name: '平安银行', groupName: '银行', groupColor: '#70b8b0',
                score: 60, allocation: 100, amount: 50000, shares: 5000,
                price: 10, rationale: '历史方案',
              },
            ],
          },
        ],
      },
    ]));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /开始分析/ }));
    await screen.findByRole('heading', { name: '保存到持仓组' });
    await user.selectOptions(screen.getByLabelText('目标持仓组'), 'pg-existing');
    await user.click(screen.getByRole('button', { name: '保存当前方案' }));

    const saved = JSON.parse(localStorage.getItem('sec_portfolio_groups_v1') || '[]');
    expect(saved[0].versions).toHaveLength(2);
    expect(saved[0].versions.map((version: { capital: number }) => version.capital)).toEqual([50000, 100000]);
    expect(saved[0].currentVersionId).toBe(saved[0].versions[1].id);
  });

  it('shows an older version as read-only historical detail', async () => {
    localStorage.setItem('sec_portfolio_groups_v1', JSON.stringify([
      {
        id: 'pg-history',
        name: '长期组合',
        createdAt: '2026-08-01T08:00:00.000Z',
        updatedAt: '2026-08-03T08:00:00.000Z',
        currentVersionId: 'pv-new',
        versions: [
          {
            id: 'pv-old',
            createdAt: '2026-08-01T08:00:00.000Z',
            capital: 50000,
            riskLevel: 'conservative',
            aiSummary: '历史AI审查结论',
            positions: [
              {
                code: '000001', name: '平安银行', groupName: '银行', groupColor: '#70b8b0',
                score: 68, allocation: 60, amount: 30000, shares: 3000,
                price: 10, rationale: '低估值',
              },
            ],
          },
          {
            id: 'pv-new',
            createdAt: '2026-08-03T08:00:00.000Z',
            capital: 100000,
            riskLevel: 'balanced',
            aiSummary: '',
            positions: [
              {
                code: '600000', name: '浦发银行', groupName: '银行', groupColor: '#70b8b0',
                score: 72, allocation: 100, amount: 100000, shares: 10000,
                price: 10, rationale: '当前方案',
              },
            ],
          },
        ],
      },
    ]));
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByRole('heading', { name: '持仓组管理' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('历史版本'), 'pv-old');

    expect(screen.getByRole('heading', { name: '历史方案详情' })).toBeInTheDocument();
    expect(screen.getByText('¥5.0万')).toBeInTheDocument();
    expect(screen.getByText('保守')).toBeInTheDocument();
    expect(screen.getByText('平安银行')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('历史AI审查结论')).toBeInTheDocument();
  });

  it('deletes a portfolio group after confirmation', async () => {
    localStorage.setItem('sec_portfolio_groups_v1', JSON.stringify([
      {
        id: 'pg-delete',
        name: '待删除组合',
        createdAt: '2026-08-03T08:00:00.000Z',
        updatedAt: '2026-08-03T08:00:00.000Z',
        currentVersionId: 'pv-delete',
        versions: [
          {
            id: 'pv-delete',
            createdAt: '2026-08-03T08:00:00.000Z',
            capital: 50000,
            riskLevel: 'balanced',
            positions: [
              {
                code: '000001', name: '平安银行', groupName: '银行', groupColor: '#70b8b0',
                score: 60, allocation: 100, amount: 50000, shares: 5000,
                price: 10, rationale: '测试方案',
              },
            ],
          },
        ],
      },
    ]));
    const confirmMock = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: '删除持仓组' }));

    expect(confirmMock).toHaveBeenCalledWith('确定删除持仓组“待删除组合”及其全部历史版本吗？');
    expect(JSON.parse(localStorage.getItem('sec_portfolio_groups_v1') || '[]')).toEqual([]);
    expect(screen.getByText('暂无已保存的持仓组')).toBeInTheDocument();
    confirmMock.mockRestore();
  });
});
