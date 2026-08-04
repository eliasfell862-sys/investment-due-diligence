import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { StockRecommendation } from '../../engines/market-analysis/stock-recommender';
import type { StockQuote } from '../../infrastructure/market-data/stock-api';
import { StockRecommendPage } from './StockRecommendPage';

const mocks = vi.hoisted(() => ({
  loadStockDirectory: vi.fn(),
  fetchSinaQuotes: vi.fn(),
  recommendStocks: vi.fn(),
  realtimeHook: vi.fn(),
  refreshNow: vi.fn(),
}));

vi.mock('../../infrastructure/market-data/stock-api', () => ({
  loadStockDirectory: mocks.loadStockDirectory,
  fetchSinaQuotes: mocks.fetchSinaQuotes,
}));

vi.mock('../../engines/market-analysis/stock-recommender', () => ({
  recommendStocks: mocks.recommendStocks,
}));

vi.mock('./useRealtimeStockQuotes', () => ({
  useRealtimeStockQuotes: mocks.realtimeHook,
}));

vi.mock('./RealtimeQuoteStatus', () => ({
  RealtimeQuoteStatus: ({ onRefresh }: { onRefresh: () => void }) => (
    <button type="button" onClick={onRefresh}>refresh quotes</button>
  ),
}));

function quote(code: string, price: number, changePct = 1): StockQuote {
  return {
    code,
    name: code === '000001' ? 'Alpha Bank' : 'Beta Corp',
    market: code.startsWith('6') ? 'sh' : 'sz',
    price,
    change: 0.2,
    changePct,
    open: price - 0.1,
    high: price + 0.2,
    low: price - 0.2,
    volume: 1_000_000,
    amount: 10_000_000,
    preClose: price - 0.2,
    turnover: 3,
    pe: 15,
    pb: 1.5,
    totalShares: 100,
    floatShares: 80,
    totalCap: 600,
    floatCap: 480,
  };
}

const recommendations: StockRecommendation[] = [
  { code: '000001', name: 'Alpha Bank', price: 12, changePct: 1, score: 90, summary: 'Alpha summary', signals: ['Alpha signal'] },
  { code: '600000', name: 'Beta Corp', price: 20, changePct: -1, score: 70, summary: 'Beta summary', signals: ['Beta signal'] },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/projects/default/securities/recommend']}>
      <Routes>
        <Route path="/projects/:projectId/securities/recommend" element={<StockRecommendPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StockRecommendPage realtime quotes', () => {
  beforeEach(() => {
    mocks.loadStockDirectory.mockReset().mockResolvedValue([
      { code: '000001', name: 'Alpha Bank', industry: 'Bank' },
      { code: '600000', name: 'Beta Corp', industry: 'Industry' },
    ]);
    mocks.fetchSinaQuotes.mockReset().mockResolvedValue([quote('000001', 12), quote('600000', 20, -1)]);
    mocks.recommendStocks.mockReset().mockResolvedValue(recommendations);
    mocks.refreshNow.mockReset().mockResolvedValue(undefined);
    mocks.realtimeHook.mockReset().mockReturnValue({
      quotes: {}, refreshing: false, marketStatus: 'trading', lastUpdatedAt: null,
      stale: false, error: '', refreshNow: mocks.refreshNow,
    });
  });

  it('updates prices while preserving ranking, score, summaries, and signals', async () => {
    const view = renderPage();
    await waitFor(() => expect(mocks.loadStockDirectory).toHaveBeenCalled());
    const analyzeButton = screen.getAllByRole('button').find(button => button.classList.contains('button'))!;
    await userEvent.click(analyzeButton);
    await screen.findByText('Alpha summary');

    mocks.realtimeHook.mockReturnValue({
      quotes: {
        '000001': quote('000001', 8, -2),
        '600000': quote('600000', 88, 6),
      },
      refreshing: false, marketStatus: 'trading', lastUpdatedAt: '2026-08-04T02:00:03.000Z',
      stale: false, error: '', refreshNow: mocks.refreshNow,
    });
    view.rerender(
      <MemoryRouter initialEntries={['/projects/default/securities/recommend']}>
        <Routes><Route path="/projects/:projectId/securities/recommend" element={<StockRecommendPage />} /></Routes>
      </MemoryRouter>,
    );

    const firstCard = screen.getByText('Alpha summary').closest('div[style*="cursor: pointer"]')!;
    const secondCard = screen.getByText('Beta summary').closest('div[style*="cursor: pointer"]')!;
    expect(firstCard).toHaveTextContent('#1');
    expect(firstCard).toHaveTextContent('90');
    expect(firstCard).toHaveTextContent('Alpha signal');
    expect(firstCard).toHaveTextContent('8.00');
    expect(firstCard).toHaveTextContent('-2.00%');
    expect(secondCard).toHaveTextContent('#2');
    expect(secondCard).toHaveTextContent('70');
    expect(secondCard).toHaveTextContent('Beta signal');
    expect(secondCard).toHaveTextContent('88.00');
    expect(secondCard).toHaveTextContent('+6.00%');
    expect(mocks.realtimeHook).toHaveBeenLastCalledWith(['000001', '600000']);
  });

  it('refreshes quotes without recalculating recommendations', async () => {
    renderPage();
    await waitFor(() => expect(mocks.loadStockDirectory).toHaveBeenCalled());
    const analyzeButton = screen.getAllByRole('button').find(button => button.classList.contains('button'))!;
    await userEvent.click(analyzeButton);
    await screen.findByText('refresh quotes');
    expect(mocks.recommendStocks).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole('button', { name: 'refresh quotes' }));
    expect(mocks.refreshNow).toHaveBeenCalledOnce();
    expect(mocks.recommendStocks).toHaveBeenCalledOnce();
  });
});
