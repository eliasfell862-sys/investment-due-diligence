import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StockQuote } from '../../infrastructure/market-data/stock-api';

const realtime = vi.hoisted(() => ({ current: null as any, refreshNow: vi.fn().mockResolvedValue(undefined) }));

vi.mock('./useRealtimeStockQuotes', () => ({ useRealtimeStockQuotes: vi.fn(() => realtime.current) }));
vi.mock('./realtime-price-targets', () => ({
  computeRealtimePriceTargets: vi.fn((_klines: any[], stock: StockQuote) => ({
    buyPrice: (stock.price - 1).toFixed(2),
    sellPrice: (stock.price + 1).toFixed(2),
    stopLoss: (stock.price - 2).toFixed(2),
    supportLevel: (stock.price - 1.5).toFixed(2),
    resistanceLevel: (stock.price + 1.5).toFixed(2),
    atr: '1.00', position: '10%', positionNote: 'test',
  })),
}));
vi.mock('../../infrastructure/market-data/stock-api', () => ({
  fetchEastmoneyKLine: vi.fn().mockResolvedValue(Array.from({ length: 61 }, (_, index) => ({
    date: `2026-06-${String(index + 1).padStart(2, '0')}`,
    open: 10, close: 10.1, high: 10.3, low: 9.8, volume: 1_000, amount: 10_000,
  }))),
  fetchEastmoneyBasic: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../engines/market-analysis/backtest-engine', () => ({ runBacktest: vi.fn(() => ({ totalTrades: 0 })) }));
vi.mock('../../engines/market-analysis/fundamental-scorer', () => ({
  scoreFundamentals: vi.fn(() => ({ rating: 'B', totalScore: 70, dimensions: [] })),
}));
vi.mock('../../engines/market-analysis/trading-strategies', () => ({ scanStrategies: vi.fn(() => []) }));
vi.mock('../../engines/market-analysis/kline-patterns', () => ({ scanPatterns: vi.fn(() => []) }));
vi.mock('../../infrastructure/market-data/capital-flow-api', () => ({
  fetchStockFundFlow: vi.fn().mockResolvedValue(null), fmtFundFlow: vi.fn(() => '-'), flowColor: vi.fn(() => '#999'),
}));
vi.mock('../../engines/market-analysis/multi-agent-debate', () => ({ runMultiAgentDebate: vi.fn() }));
vi.mock('../../engines/market-analysis/deep-research-engine', () => ({ runDeepResearch: vi.fn() }));

import { StockAnalysisPage } from './StockAnalysisPage';

function quote(price: number): StockQuote {
  return {
    code: '000001', name: 'Test Stock', market: 'sz', price,
    change: price - 10, changePct: (price - 10) * 10,
    open: 10, high: price, low: 9.9, volume: 2_000, amount: 20_000,
    preClose: 10, turnover: 1, pe: 10, pb: 1,
    totalShares: 1, floatShares: 1, totalCap: 100, floatCap: 80,
  };
}

function snapshot(currentQuote: StockQuote) {
  return {
    quotes: { [currentQuote.code]: currentQuote }, refreshing: false,
    marketStatus: 'trading' as const, lastUpdatedAt: '2026-08-04T05:00:00.000Z',
    stale: false, error: '', refreshNow: realtime.refreshNow,
  };
}

function app() {
  return <MemoryRouter initialEntries={['/projects/default/securities/stock/000001']}>
    <Routes><Route path="/projects/:projectId/securities/stock/:code" element={<StockAnalysisPage />} /></Routes>
  </MemoryRouter>;
}

describe('StockAnalysisPage realtime price targets', () => {
  beforeEach(() => { vi.clearAllMocks(); realtime.current = snapshot(quote(12.34)); });

  it('renders new buy and sell targets when the live quote changes', async () => {
    const view = render(app());
    expect(await screen.findByText('11.34')).toBeInTheDocument();
    expect(await screen.findByText('13.34')).toBeInTheDocument();
    realtime.current = snapshot(quote(12.5));
    view.rerender(app());
    expect(await screen.findByText('11.50')).toBeInTheDocument();
    expect(await screen.findByText('13.50')).toBeInTheDocument();
  });
});
