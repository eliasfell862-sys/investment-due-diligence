import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { StockQuote } from '../../infrastructure/market-data/stock-api';
import { StockScreenerPage } from './StockScreenerPage';

const mocks = vi.hoisted(() => ({
  loadStockDirectory: vi.fn(),
  fetchSinaQuotes: vi.fn(),
  realtimeHook: vi.fn(),
  refreshNow: vi.fn(),
}));

vi.mock('../../infrastructure/market-data/stock-api', () => ({
  loadStockDirectory: mocks.loadStockDirectory,
  fetchSinaQuotes: mocks.fetchSinaQuotes,
}));

vi.mock('./useRealtimeStockQuotes', () => ({
  useRealtimeStockQuotes: mocks.realtimeHook,
}));

vi.mock('./RealtimeQuoteStatus', () => ({
  RealtimeQuoteStatus: ({ onRefresh }: { onRefresh: () => void }) => (
    <button type="button" onClick={onRefresh}>refresh quotes</button>
  ),
}));

function quote(code: string, price: number, overrides: Partial<StockQuote> = {}): StockQuote {
  return {
    code,
    name: code === '000001' ? 'First Bank' : 'Second Stock',
    market: code.startsWith('6') ? 'sh' : 'sz',
    price,
    change: 0.2,
    changePct: 1,
    open: price - 0.1,
    high: price + 0.2,
    low: price - 0.2,
    volume: 1_000_000,
    amount: 10_000_000,
    preClose: price - 0.2,
    turnover: 5,
    pe: 20,
    pb: 1.5,
    totalShares: 100,
    floatShares: 80,
    totalCap: 600,
    floatCap: 480,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/projects/default/securities/screener']}>
      <Routes>
        <Route path="/projects/:projectId/securities/screener" element={<StockScreenerPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StockScreenerPage realtime quotes', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadStockDirectory.mockReset().mockResolvedValue([
      { code: '000001', name: 'First Bank', industry: 'Bank' },
      { code: '600000', name: 'Second Stock', industry: 'Industry' },
    ]);
    mocks.fetchSinaQuotes.mockReset().mockResolvedValue([
      quote('000001', 12),
      quote('600000', 20, { changePct: 3, pe: 10 }),
    ]);
    mocks.refreshNow.mockReset().mockResolvedValue(undefined);
    mocks.realtimeHook.mockReset().mockReturnValue({
      quotes: {}, refreshing: false, marketStatus: 'trading', lastUpdatedAt: null,
      stale: false, error: '', refreshNow: mocks.refreshNow,
    });
  });

  it('updates quote fields without changing result order or scores', async () => {
    const view = renderPage();
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(5));
    const actionButtons = screen.getAllByRole('button').filter(button => button.classList.contains('button'));
    await userEvent.click(actionButtons[0]);

    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3));
    const initialRows = screen.getAllByRole('row');
    expect(initialRows[1]).toHaveTextContent('000001');
    expect(initialRows[1]).toHaveTextContent('67');
    expect(initialRows[2]).toHaveTextContent('600000');
    expect(initialRows[2]).toHaveTextContent('76');

    mocks.realtimeHook.mockReturnValue({
      quotes: {
        '000001': quote('000001', 8, { changePct: -2 }),
        '600000': quote('600000', 88, { changePct: 6 }),
      },
      refreshing: false, marketStatus: 'trading', lastUpdatedAt: '2026-08-04T02:00:03.000Z',
      stale: false, error: '', refreshNow: mocks.refreshNow,
    });
    view.rerender(
      <MemoryRouter initialEntries={['/projects/default/securities/screener']}>
        <Routes><Route path="/projects/:projectId/securities/screener" element={<StockScreenerPage />} /></Routes>
      </MemoryRouter>,
    );

    const liveRows = screen.getAllByRole('row');
    expect(liveRows[1]).toHaveTextContent('000001');
    expect(liveRows[1]).toHaveTextContent('67');
    expect(liveRows[1]).toHaveTextContent('8.00');
    expect(liveRows[2]).toHaveTextContent('600000');
    expect(liveRows[2]).toHaveTextContent('76');
    expect(liveRows[2]).toHaveTextContent('88.00');
    expect(mocks.realtimeHook).toHaveBeenLastCalledWith(['000001', '600000']);
  });

  it('refreshes quotes without running the screener again', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(5));
    const actionButtons = screen.getAllByRole('button').filter(button => button.classList.contains('button'));
    await userEvent.click(actionButtons[0]);
    await screen.findByText('refresh quotes');
    expect(mocks.fetchSinaQuotes).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole('button', { name: 'refresh quotes' }));
    expect(mocks.refreshNow).toHaveBeenCalledOnce();
    expect(mocks.fetchSinaQuotes).toHaveBeenCalledOnce();
  });
});
