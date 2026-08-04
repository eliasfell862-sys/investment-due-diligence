import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { BacktestSignalAlert } from './backtest-signal-inbox-store';

const mocks = vi.hoisted(() => ({
  hookResult: {} as any,
  useRealtimeBacktestMonitor: vi.fn(),
  loadStockLedger: vi.fn(),
  buyStockPosition: vi.fn(),
  sellStockPosition: vi.fn(),
}));

vi.mock('./useRealtimeBacktestMonitor', () => ({
  useRealtimeBacktestMonitor: mocks.useRealtimeBacktestMonitor,
}));
vi.mock('./stock-position-ledger', async importOriginal => {
  const original = await importOriginal<typeof import('./stock-position-ledger')>();
  return {
    ...original,
    loadStockLedger: mocks.loadStockLedger,
    buyStockPosition: mocks.buyStockPosition,
    sellStockPosition: mocks.sellStockPosition,
  };
});

import { SignalInbox } from './SignalInbox';

function signalAlert(action: 'buy' | 'sell', status: 'pending' | 'bought' | 'sold' = 'pending'): BacktestSignalAlert {
  return {
    id: `alert-${action}`, code: '000001', name: '平安银行', price: 10.8,
    action, reasons: [action === 'buy' ? 'MACD金叉' : 'MACD死叉'],
    signalAt: '2026-08-04T01:30:00.000Z', status, readAt: null, executedAt: null,
    entryPrice: 10.8, stopLoss: 9.2,
    metrics: {
      totalTrades: 12, winRate: 58, sharpeRatio: 1.1,
      maxDrawdown: 12, annualReturn: 18, profitFactor: 1.4,
    },
  };
}

function ledger(withPosition = false) {
  return {
    version: 1 as const,
    groups: [{ id: 'default', name: '默认持仓' }],
    positions: withPosition ? [{
      id: 'position-1', groupId: 'default', code: '000001', name: '平安银行',
      shares: 300, averageCost: 10, totalCost: 3_000,
      openedAt: '2026-08-01T01:30:00.000Z', updatedAt: '2026-08-01T01:30:00.000Z',
      sourceAlertIds: ['alert-buy'],
    }] : [],
    transactions: [],
  };
}

function setupHook(alerts: BacktestSignalAlert[]) {
  mocks.hookResult = {
    alerts,
    unreadCount: alerts.filter(alert => !alert.readAt).length,
    checking: false,
    partialFailureCount: 0,
    marketStatus: 'trading',
    lastUpdatedAt: '2026-08-04T01:30:00.000Z',
    error: '',
    refreshNow: vi.fn().mockResolvedValue(undefined),
    markRead: vi.fn(),
    markExecuted: vi.fn(),
    clearAlerts: vi.fn(),
    reloadLedger: vi.fn(),
  };
  mocks.useRealtimeBacktestMonitor.mockImplementation(() => mocks.hookResult);
}

function renderInbox() {
  return render(
    <MemoryRouter initialEntries={['/projects/project-1/securities']}>
      <Routes>
        <Route path="/projects/:projectId/securities" element={<SignalInbox />} />
        <Route path="/projects/:projectId/securities/stock/:code" element={<div>个股分析目标页</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SignalInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHook([]);
    mocks.loadStockLedger.mockReturnValue(ledger());
    mocks.buyStockPosition.mockReturnValue({ ledger: ledger(true), position: ledger(true).positions[0] });
    mocks.sellStockPosition.mockReturnValue({ ledger: ledger(false), position: null });
  });

  it('shows unread realtime alerts without marking all messages read when opened', async () => {
    const user = userEvent.setup();
    setupHook([signalAlert('buy')]);
    renderInbox();

    expect(screen.getByTitle('实时回测买卖信号')).toHaveTextContent('1');
    await user.click(screen.getByTitle('实时回测买卖信号'));
    expect(screen.getByText('平安银行 (000001)')).toBeInTheDocument();
    expect(screen.getByText(/MACD金叉/)).toBeInTheDocument();
    expect(mocks.hookResult.markRead).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '标记已读 平安银行' }));
    expect(mocks.hookResult.markRead).toHaveBeenCalledWith('alert-buy');
  });

  it('confirms a buy, writes the actual position first, then marks the alert executed', async () => {
    const user = userEvent.setup();
    setupHook([signalAlert('buy')]);
    renderInbox();

    await user.click(screen.getByTitle('实时回测买卖信号'));
    await user.click(screen.getByRole('button', { name: '确认买入 平安银行' }));
    await user.click(screen.getByRole('button', { name: '确认买入' }));

    expect(mocks.buyStockPosition).toHaveBeenCalledWith(expect.objectContaining({
      code: '000001', name: '平安银行', shares: 100, price: 10.8,
      groupId: 'default', groupName: '默认持仓', sourceAlertId: 'alert-buy',
    }));
    expect(mocks.hookResult.markExecuted).toHaveBeenCalledWith('alert-buy', 'bought', true);
    expect(mocks.hookResult.reloadLedger).toHaveBeenCalledOnce();
    expect(mocks.buyStockPosition.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.hookResult.markExecuted.mock.invocationCallOrder[0]);
  });

  it('supports a partial sale and keeps the position monitored', async () => {
    const user = userEvent.setup();
    setupHook([signalAlert('sell')]);
    mocks.loadStockLedger.mockReturnValue(ledger(true));
    mocks.sellStockPosition.mockReturnValue({
      ledger: ledger(true),
      position: { ...ledger(true).positions[0], shares: 225, totalCost: 2_250 },
    });
    renderInbox();

    await user.click(screen.getByTitle('实时回测买卖信号'));
    await user.click(screen.getByRole('button', { name: '确认卖出 平安银行' }));
    await user.clear(screen.getByLabelText('交易股数'));
    await user.type(screen.getByLabelText('交易股数'), '75');
    await user.click(screen.getByRole('button', { name: '确认卖出' }));

    expect(mocks.sellStockPosition).toHaveBeenCalledWith(expect.objectContaining({
      code: '000001', shares: 75, price: 10.8, sourceAlertId: 'alert-sell',
    }));
    expect(mocks.hookResult.markExecuted).toHaveBeenCalledWith('alert-sell', 'sold', true);
  });

  it('does not mark a signal executed when position storage fails', async () => {
    const user = userEvent.setup();
    setupHook([signalAlert('buy')]);
    mocks.buyStockPosition.mockImplementation(() => { throw new Error('存储空间不足'); });
    renderInbox();

    await user.click(screen.getByTitle('实时回测买卖信号'));
    await user.click(screen.getByRole('button', { name: '确认买入 平安银行' }));
    await user.click(screen.getByRole('button', { name: '确认买入' }));

    expect(await screen.findByText('存储空间不足')).toBeInTheDocument();
    expect(mocks.hookResult.markExecuted).not.toHaveBeenCalled();
  });

  it('refreshes immediately, reports partial failures, and preserves the stock analysis route', async () => {
    const user = userEvent.setup();
    setupHook([signalAlert('buy')]);
    mocks.hookResult.partialFailureCount = 2;
    renderInbox();

    await user.click(screen.getByTitle('实时回测买卖信号'));
    expect(screen.getByText('2只股票监听失败')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '立即刷新信号' }));
    expect(mocks.hookResult.refreshNow).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: '查看个股 平安银行' }));
    expect(await screen.findByText('个股分析目标页')).toBeInTheDocument();
  });
});
