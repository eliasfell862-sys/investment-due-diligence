import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ useLab: vi.fn() }));
vi.mock('./strategy-learning/useStrategyLearningLab', () => ({
  useStrategyLearningLab: mocks.useLab,
}));

import { StrategyLearningLabPage } from './StrategyLearningLabPage';

const finding = (id: string, title: string, description: string) => ({
  id, title, description, evidenceKind: 'calculation' as const, evidence: [], confidence: 0.8,
});
const validationRun = (
  id: string,
  closedTrades: number,
  winRate: number,
  netReturnPct: number,
  grossReturnPct: number,
  maxDrawdownPct: number,
  periodEnd: string,
) => ({
  id,
  candidateId: 'candidate-1',
  validationType: id === 'forward' ? 'forward' : 'out_of_sample',
  universeSnapshotId: 'universe-1',
  period: { start: '2026-01-01', end: periodEnd },
  costModel: {},
  baselineMetrics: {
    netReturnPct: 0, grossReturnPct: 0, annualReturnPct: 0, maxDrawdownPct: 0,
    winRate: 0, payoffRatio: 0, profitFactor: 0, sharpe: 0, closedTrades: 0,
  },
  candidateMetrics: {
    netReturnPct, grossReturnPct, annualReturnPct: netReturnPct,
    maxDrawdownPct, winRate, payoffRatio: 1.4, profitFactor: 1.3,
    sharpe: 1.1, closedTrades,
  },
  marketRegimeMetrics: {},
  leakageChecks: { passed: true },
  overfittingChecks: { passed: true },
  passed: true,
  failureReasons: [],
  createdAt: '2026-08-01T08:00:00.000Z',
});

let currentLab: Record<string, unknown>;

function renderPage() {
  return render(<MemoryRouter><StrategyLearningLabPage /></MemoryRouter>);
}

describe('StrategyLearningLabPage', () => {
  beforeEach(() => {
    currentLab = {
      reviews: [{
        id: 'review-1', tradingDate: '2026-08-06', strategyId: 'realtime-technical',
        strategyVersion: '1', snapshotId: 'snapshot-1', status: 'completed',
        portfolioMetrics: { returnPct: 1.25, maxDrawdownPct: 0.6, openPositions: 2, transactionCost: 8.5 },
        positiveFindings: [finding('good-1', '入场纪律良好', '买入信号符合策略阈值')],
        negativeFindings: [finding('bad-1', '追涨风险', '一笔交易接近短期高位')],
        dataQuality: { completeness: 0.92, blockingIssues: ['缺少一只股票的完整分钟线'] },
        confidence: 0.86, createdAt: '2026-08-06T07:10:00.000Z', completedAt: '2026-08-06T07:15:00.000Z',
      }],
      latestDecisions: [{
        id: 'decision-1', dailyReviewId: 'review-1', code: '000001', decisionType: 'buy',
        decisionAt: '2026-08-06T02:00:00.000Z', evidence: [], positiveFindings: [],
        negativeFindings: [], attribution: {}, counterfactuals: [],
        improvementSuggestions: [finding('improve-1', '收紧追涨条件', '价格偏离均线过高时降低仓位')],
        confidence: 0.8, patternKeys: [], followUpHorizons: {},
      }],
      patterns: [], candidates: [], approvals: [], loading: false, error: '',
      validationRuns: [
        validationRun('oos', 40, 55, 8, 10, 6, '2026-06-30'),
        validationRun('forward', 60, 65, 12, 15, 9, '2026-07-31'),
      ],
      refresh: vi.fn(), exportData: vi.fn(async () => ({})),
    };
    mocks.useLab.mockImplementation(() => currentLab);
  });

  it('shows the latest daily review analysis instead of only a review count', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: '策略评估与学习中枢' })).toBeInTheDocument();
    expect(screen.getAllByText('2026-08-06')).toHaveLength(2);
    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.getByText('86%')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '策略表现与可信度校准' })).toBeInTheDocument();
    expect(screen.getByText('已建立可信度')).toBeInTheDocument();
    expect(screen.getByText('样本外胜率')).toBeInTheDocument();
    expect(screen.getByText('61.00%')).toBeInTheDocument();
    expect(screen.getByText('模型置信度')).toBeInTheDocument();
    expect(screen.getByText('86.00%')).toBeInTheDocument();
    expect(screen.getByText(/模型置信度不是历史胜率/)).toBeInTheDocument();
    expect(screen.getByText('今日虚拟交易 1 笔')).toBeInTheDocument();
    expect(screen.getByText('今日收益 1.25%')).toBeInTheDocument();
    expect(screen.getByText('未平仓 2')).toBeInTheDocument();
    expect(screen.getByText('入场纪律良好')).toBeInTheDocument();
    expect(screen.getByText('追涨风险')).toBeInTheDocument();
    expect(screen.getByText('收紧追涨条件')).toBeInTheDocument();
    expect(screen.getByText('缺少一只股票的完整分钟线')).toBeInTheDocument();
  });

  it('states clearly when the latest review contains no virtual trades', () => {
    currentLab = { ...currentLab, latestDecisions: [] };

    renderPage();

    expect(screen.getByText('今日无虚拟交易')).toBeInTheDocument();
  });

  it('explains when calibration evidence is insufficient', () => {
    currentLab = { ...currentLab, validationRuns: [] };

    renderPage();

    expect(screen.getByText('尚无样本外验证')).toBeInTheDocument();
    expect(screen.getByText('至少需要30笔闭环交易')).toBeInTheDocument();
  });
});