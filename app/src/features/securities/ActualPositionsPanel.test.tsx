import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import {
  STOCK_POSITION_LEDGER_KEY,
  loadStockLedger,
  type StockPositionLedger,
} from './stock-position-ledger';
import { ActualPositionsPanel } from './ActualPositionsPanel';

const mocks = vi.hoisted(() => ({
  realtimeHook: vi.fn(),
  refreshNow: vi.fn(),
}));

vi.mock('./useRealtimeStockQuotes', () => ({
  useRealtimeStockQuotes: mocks.realtimeHook,
}));

function heldLedger(): StockPositionLedger {
  return {
    version: 1,
    groups: [{ id: 'default', name: '默认持仓' }],
    positions: [{
      id: 'position-1', groupId: 'default', code: '000001', name: '平安银行',
      shares: 100, averageCost: 10, totalCost: 1_000,
      openedAt: '2026-08-05T01:30:00.000Z', updatedAt: '2026-08-05T01:30:00.000Z',
      sourceAlertIds: ['manual-1'],
    }],
    transactions: [{
      id: 'transaction-1', groupId: 'default', code: '000001', name: '平安银行',
      type: 'buy', shares: 100, price: 10, amount: 1_000,
      tradedAt: '2026-08-05T01:30:00.000Z', sourceAlertId: 'manual-1', realizedProfit: 0,
    }],
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderPanel() {
  return render(
    <MemoryRouter initialEntries={['/projects/default/securities/portfolio']}>
      <Routes>
        <Route path="*" element={<><ActualPositionsPanel projectId="default" /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ActualPositionsPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.refreshNow.mockReset().mockResolvedValue(undefined);
    mocks.realtimeHook.mockReset().mockReturnValue({
      quotes: {
        '000001': {
          code: '000001', name: '平安银行', market: 'sz', price: 12,
          change: 2, changePct: 20, open: 10, high: 12, low: 10,
          volume: 1_000, amount: 12_000, preClose: 10, turnover: 1,
          pe: 10, pb: 1, totalShares: 1, floatShares: 1, totalCap: 1, floatCap: 1,
        },
      },
      refreshing: false, marketStatus: 'trading', lastUpdatedAt: '2026-08-05T02:00:00.000Z',
      stale: false, error: '', refreshNow: mocks.refreshNow,
    });
  });

  it('shows live actual-position value and floating profit', () => {
    localStorage.setItem(STOCK_POSITION_LEDGER_KEY, JSON.stringify(heldLedger()));
    renderPanel();

    expect(screen.getByRole('heading', { name: '我的实际持仓' })).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /000001 平安银行/ });
    expect(within(row).getByText('100 股')).toBeInTheDocument();
    expect(within(row).getByText('¥10.00')).toBeInTheDocument();
    expect(screen.getByText('¥1,000.00')).toBeInTheDocument();
    expect(within(row).getByText('¥1,200.00')).toBeInTheDocument();
    expect(within(row).getByText('+¥200.00')).toBeInTheDocument();
    expect(within(row).getByText('+20.00%')).toBeInTheDocument();
    expect(mocks.realtimeHook).toHaveBeenCalledWith(['000001']);
  });

  it('shows an empty state with a watchlist link', () => {
    renderPanel();
    expect(screen.getByText('暂无实际持仓')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '前往自选股加入持仓' }))
      .toHaveAttribute('href', '/projects/default/securities/watchlist');
  });

  it('adds to an existing position at the realtime price and keeps its group', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STOCK_POSITION_LEDGER_KEY, JSON.stringify(heldLedger()));
    renderPanel();

    await user.click(await screen.findByRole('button', { name: '补仓 平安银行' }));
    expect(screen.getByLabelText('交易股数')).toHaveValue(100);
    expect(screen.getByLabelText('成交价格')).toHaveValue(12);
    const dialog = screen.getByRole('dialog', { name: '确认补仓 平安银行' });
    expect(within(dialog).getByText('默认持仓')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认补仓' }));

    await waitFor(() => expect(loadStockLedger().positions[0]).toMatchObject({
      shares: 200, averageCost: 11, groupId: 'default',
    }));
  });

  it('sells the entire position and returns to the empty state', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STOCK_POSITION_LEDGER_KEY, JSON.stringify(heldLedger()));
    renderPanel();

    await user.click(await screen.findByRole('button', { name: '卖出 平安银行' }));
    expect(screen.getByLabelText('交易股数')).toHaveValue(100);
    await user.click(screen.getByRole('button', { name: '确认全部卖出' }));

    expect(await screen.findByText('暂无实际持仓')).toBeInTheDocument();
    expect(loadStockLedger().positions).toEqual([]);
  });

  it('moves a position to a new group without adding a transaction', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STOCK_POSITION_LEDGER_KEY, JSON.stringify(heldLedger()));
    renderPanel();

    await user.click(await screen.findByRole('button', { name: '调整持仓组 平安银行' }));
    await user.selectOptions(screen.getByLabelText('目标持仓组'), '__new__');
    await user.type(screen.getByLabelText('新持仓组名称'), '核心持仓');
    await user.click(screen.getByRole('button', { name: '确认调整' }));

    await waitFor(() => expect(loadStockLedger().positions[0].groupId).toMatch(/^group-/));
    expect(loadStockLedger().groups).toContainEqual(expect.objectContaining({ name: '核心持仓' }));
    expect(loadStockLedger().transactions).toHaveLength(1);
  });

  it('opens the existing stock analysis route', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STOCK_POSITION_LEDGER_KEY, JSON.stringify(heldLedger()));
    renderPanel();

    await user.click(await screen.findByRole('button', { name: '查看个股 平安银行' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/default/securities/stock/000001');
  });

  it('reports a corrupted ledger and disables position mutations', () => {
    localStorage.setItem(STOCK_POSITION_LEDGER_KEY, '{broken');
    renderPanel();

    expect(screen.getByRole('alert')).toHaveTextContent('实际持仓数据损坏');
    expect(screen.queryByRole('button', { name: /补仓/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /卖出/ })).not.toBeInTheDocument();
    expect(localStorage.getItem(STOCK_POSITION_LEDGER_KEY)).toBe('{broken');
  });
});
