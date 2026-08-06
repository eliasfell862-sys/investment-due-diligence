import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PreMoveRadarPage } from './PreMoveRadarPage';

vi.mock('./pre-move-radar/usePreMoveRadar', () => ({ usePreMoveRadar: () => ({
  result: { scanId: 'scan', tradingDate: '2026-08-06', formal: true, marketRegime: 'strong',
    industries: [{ industry: '银行', rank: 1, compositeScore: 85, returnPct1d: 2, returnPct5d: null, returnPct10d: null,
      mainNet1d: 100, mainNet5d: 200, mainNet10d: 300, stage: 'starting' }],
    predictions: [{ code: '000001', name: '平安银行', industry: '银行', source: 'watchlist', currentPrice: 10,
      signalScore: 70, scores: { industryRotation: 20, capitalFlow: 20, accumulation: 15, relativeStrength: 8, upsideRoom: 7, total: 70 },
      rawFeatures: {}, featureCoverage: [], probability: 68, confidence: 70, formalProbability: true, sampleSize: 220,
      similarSampleSize: 42, status: 'layout_ready', expectedWindow: '5_10', positiveEvidence: ['资金先行流入'], risks: ['板块可能转弱'],
      invalidationConditions: ['跌破MA20'], dataCompleteness: 1, dataSources: ['东方财富'], dataAsOf: '2026-08-06T07:20:00Z' }],
    errors: [], dataAsOf: '2026-08-06T07:20:00Z', cacheStatus: 'fresh' },
  visiblePredictions: [{ code: '000001', name: '平安银行', industry: '银行', source: 'watchlist', currentPrice: 10,
    signalScore: 70, scores: { industryRotation: 20, capitalFlow: 20, accumulation: 15, relativeStrength: 8, upsideRoom: 7, total: 70 },
    rawFeatures: {}, featureCoverage: [], probability: 68, confidence: 70, formalProbability: true, sampleSize: 220,
    similarSampleSize: 42, status: 'layout_ready', expectedWindow: '5_10', positiveEvidence: ['资金先行流入'], risks: ['板块可能转弱'],
    invalidationConditions: ['跌破MA20'], dataCompleteness: 1, dataSources: ['东方财富'], dataAsOf: '2026-08-06T07:20:00Z' }],
  filter: 'all', setFilter: vi.fn(), loading: false, error: '', refresh: vi.fn() }) }));

describe('PreMoveRadarPage', () => {
  it('renders probability, confidence, status and evidence', () => {
    render(<MemoryRouter><PreMoveRadarPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: '启动预期雷达' })).toBeInTheDocument();
    expect(screen.getByText('可布局')).toBeInTheDocument();
    expect(screen.getByText('启动预期 68%')).toBeInTheDocument();
    expect(screen.getByText('相似样本 42')).toBeInTheDocument();
    expect(screen.getByText(/未来 5–10 个交易日/)).toBeInTheDocument();
    expect(screen.getByText('资金先行流入')).toBeInTheDocument();
  });
  it('navigates to the existing stock analysis route', async () => {
    render(<MemoryRouter initialEntries={['/projects/p1/securities/pre-move-radar']}><Routes>
      <Route path="/projects/:projectId/securities/pre-move-radar" element={<PreMoveRadarPage />} />
      <Route path="/projects/:projectId/securities/stock/:code" element={<div>个股目标页</div>} />
    </Routes></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /平安银行/ }));
    expect(screen.getByText('个股目标页')).toBeInTheDocument();
  });
});