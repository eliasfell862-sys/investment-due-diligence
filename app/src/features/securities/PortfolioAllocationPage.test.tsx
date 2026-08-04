import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PortfolioAllocationPage } from './PortfolioAllocationPage';

const mocks = vi.hoisted(() => ({
  fetchSinaQuotes: vi.fn(),
  realtimeHook: vi.fn(),
  refreshNow: vi.fn(),
  buildPortfolio: vi.fn(),
}));

vi.mock('./useRealtimeStockQuotes', () => ({
  useRealtimeStockQuotes: mocks.realtimeHook,
}));
vi.mock('./all-watchlists-portfolio-service', () => ({
  buildAllWatchlistsPortfolio: mocks.buildPortfolio,
}));


vi.mock('../../infrastructure/market-data/stock-api', () => ({
  fetchSinaQuotes: mocks.fetchSinaQuotes.mockResolvedValue([
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

function deterministicResult() {
  const quote = {
    code: '000001', name: '平安银行', market: 'sz' as const, price: 10, change: 0, changePct: 0,
    open: 10, high: 10.2, low: 9.8, volume: 100000, amount: 2_000_000, preClose: 10,
    turnover: 2, pe: 8, pb: 1, totalShares: 100, floatShares: 80, totalCap: 2000, floatCap: 1600,
  };
  const returns = Array.from({ length: 80 }, (_, index) => ({ date: String(index), value: index % 2 ? 0.01 : -0.01 }));
  const selected = [{
    code: '000001', name: '平安银行', quote, industry: '银行', classificationStatus: 'official' as const,
    sources: [{ watchlistId: 'wl-1', watchlistName: '核心池', groupIds: [], labels: ['价值'] }],
    labels: ['价值'], score: 67, confidence: 85,
    mediumTermAdvice: {
      code: '000001', horizon: '1_3_months' as const, action: 'cautious_buy' as const, label: '谨慎买入' as const,
      score: 67, confidence: 85, confidenceLabel: '高' as const, reasons: ['估值合理'], risks: ['波动风险'],
      dataCompleteness: { quote: true, kline: true, fundamental: true }, calculatedAt: '2026-08-04T08:00:00.000Z',
    },
    fundamental: null, strategies: [], patterns: [],
    risk: { returns, annualizedVolatility: 0.18, maximumDrawdown: 0.15 }, returns,
    dataCompleteness: { quote: true, kline: true, fundamental: true, industry: true }, dataAsOf: '2026-08-04',
  }];
  return {
    algorithmVersion: 'all-watchlists-risk-parity-v1' as const,
    snapshot: {
      id: 'snapshot-1', createdAt: '2026-08-04T08:00:00.000Z', candidates: [
        { code: '000001', labels: ['价值'], sources: selected[0].sources },
        { code: '000002', labels: ['成长'], sources: [{ watchlistId: 'wl-2', watchlistName: '观察池', groupIds: [], labels: ['成长'] }] },
      ],
      sourceWatchlists: [{ id: 'wl-1', name: '核心池' }, { id: 'wl-2', name: '观察池' }], warnings: [],
    },
    riskLevel: 'balanced' as const,
    parameters: { scoreThreshold: 65 },
    selected,
    excluded: [{ code: '000002', reasonCode: 'score_threshold' as const, reason: '评分不足' }],
    targetWeights: { '000001': 0.20 },
    riskContributions: { '000001': 1 },
    sizing: {
      positions: [{ code: '000001', name: '平安银行', price: 10, targetWeight: 0.20, targetAmount: 20000,
        shares: 2000, actualAmount: 20000, actualWeight: 0.20, weightDeviation: 0 }],
      investedAmount: 20000, actualStockWeight: 0.20, minimumCashAmount: 10000,
      constraintCashAmount: 70000, boardLotCashAmount: 0, totalCashAmount: 80000,
    },
    metrics: { annualizedVolatility: 0.18, concentration: 0.04, maximumPairCorrelation: null },
    dataAsOf: '2026-08-04', stale: false,
  };
}
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
    mocks.refreshNow.mockReset().mockResolvedValue(undefined);
    mocks.fetchSinaQuotes.mockClear();
    mocks.buildPortfolio.mockReset().mockImplementation(async (
      _request: unknown,
      options?: { onProgress?: (item: { snapshotId: string; completed: number; total: number; successes: number; failures: number }) => void },
    ) => {
      options?.onProgress?.({ snapshotId: 'snapshot-1', completed: 2, total: 2, successes: 1, failures: 1 });
      return deterministicResult();
    });
    mocks.realtimeHook.mockReset().mockReturnValue({
      quotes: {
        '000001': {
          code: '000001', name: '平安银行', market: 'sz', price: 12, change: 2, changePct: 20,
          open: 10, high: 12, low: 10, preClose: 10, volume: 1000, amount: 12000,
          turnover: 1, pe: 8, pb: 1, totalShares: 100, floatShares: 80, totalCap: 2000, floatCap: 1600,
        },
      },
      refreshing: false, marketStatus: 'trading', lastUpdatedAt: '2026-08-04T02:00:00.000Z',
      stale: false, error: '', refreshNow: mocks.refreshNow,
    });
  });

  it('overlays candidate price and shares without rerunning analysis on quote refresh', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /开始分析/ }));
    const livePrice = await screen.findByText('12.00');
    expect(livePrice).toBeInTheDocument();
    const candidateRow = livePrice.closest('tr');
    expect(candidateRow).toHaveTextContent('67');
    expect(candidateRow).toHaveTextContent('20%');
    expect(candidateRow).toHaveTextContent('¥2.0万');
    expect(screen.getByText('1600股')).toBeInTheDocument();
    expect(mocks.buildPortfolio).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '立即刷新' }));
    expect(mocks.refreshNow).toHaveBeenCalledOnce();
    expect(mocks.buildPortfolio).toHaveBeenCalledTimes(1);
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
      algorithmVersion: 'all-watchlists-risk-parity-v1',
      candidateSnapshotId: 'snapshot-1',
      sourceWatchlists: [{ id: 'wl-1', name: '核心池' }, { id: 'wl-2', name: '观察池' }],
      cashBreakdown: {
        minimumCashAmount: 10000, constraintCashAmount: 70000,
        boardLotCashAmount: 0, totalCashAmount: 80000,
      },
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
    expect(screen.getByRole('columnheader', { name: '保存价格' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '当前价' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '当前市值' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '浮动盈亏' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '收益率' })).toBeInTheDocument();
    expect(screen.getByText('12.00')).toBeInTheDocument();
    expect(screen.getByText('¥3.60万')).toBeInTheDocument();
    expect(screen.getByText('+¥0.60万')).toBeInTheDocument();
    expect(screen.getByText('+20.00%')).toBeInTheDocument();
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

  it('uses the all-watchlists engine and exposes deterministic cash and exclusions', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: '开始分析全部自选股' }));

    expect(mocks.buildPortfolio).toHaveBeenCalledWith(
      { capital: 100000, riskLevel: 'balanced', force: true },
      expect.objectContaining({ onProgress: expect.any(Function), shouldPublish: expect.any(Function) }),
    );
    expect(await screen.findByText('全部 2 只候选分析完成')).toBeInTheDocument();
    expect(screen.getByText('目标股票仓位 20%')).toBeInTheDocument();
    expect(screen.getByText('最低现金 10%')).toBeInTheDocument();
    expect(screen.getByText('约束现金 70%')).toBeInTheDocument();
    expect(screen.getByText('整手零碎现金 0%')).toBeInTheDocument();
    expect(screen.getByText(/未达到质量门槛，不强制补位/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '查看全部未入选股票' }));
    expect(screen.getByText('000002')).toBeInTheDocument();
    expect(screen.getByText(/评分不足/)).toBeInTheDocument();
  });
});
