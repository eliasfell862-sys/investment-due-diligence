import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeBuy: vi.fn(), reloadLedger: vi.fn(), reloadInbox: vi.fn(), markRead: vi.fn(),
  refreshRuntime: vi.fn(), executeTTradeSell: vi.fn(), reloadTState: vi.fn(), alerts: [] as any[],
  monitoringCount: 6, watchlistCount: 3, heldCount: 2, successfulCount: 6,
  lastScanAt: '2026-08-12T04:30:00.000Z', checking: false, monitorError: '',
}));

vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'user-a' } }) }));
vi.mock('./useCloudSignalInbox', () => ({
  useCloudSignalInbox: () => ({
    alerts: mocks.alerts,
    loading: false, error: '', unreadCount: mocks.alerts.filter(alert => !alert.readAt).length,
    reload: mocks.reloadInbox, markRead: mocks.markRead,
  }),
}));
vi.mock('./SecuritiesDataSourceProvider', () => ({
  useSecuritiesDataSource: () => ({
    ledger: { version: 1, groups: [{ id: 'core', name: '核心持仓' }], positions: [], transactions: [] },
    reloadLedger: mocks.reloadLedger,
  }),
}));
vi.mock('../RealtimeBacktestMonitorProvider', () => ({
  useOptionalRealtimeBacktestMonitorContext: () => ({
    refreshNow: mocks.refreshRuntime,
    monitoringCount: mocks.monitoringCount, watchlistCount: mocks.watchlistCount,
    heldCount: mocks.heldCount, successfulCount: mocks.successfulCount,
    lastScanAt: mocks.lastScanAt, checking: mocks.checking, error: mocks.monitorError,
    virtualLedger: {
      version: 1,
      positions: [{
        id: 'virtual-a', cycleId: 'cycle-a', strategyId: 'realtime', strategyVersion: '3',
        code: '300750', name: 'CATL', shares: 100, averageCost: 200, totalCost: 20000,
        openedAt: '2026-08-07T01:30:00Z', updatedAt: '2026-08-07T01:30:00Z',
        sourceTradeIds: ['trade-a'],
      }],
      transactions: [{
        id: 'virtual-trade-a', sourceSignalId: 'alert-a', cycleId: 'cycle-a',
        strategyId: 'realtime', strategyVersion: '3', code: '300750', name: 'CATL',
        type: 'buy', intent: 'open', shares: 100, price: 200, amount: 20000,
        tradedAt: '2026-08-07T01:30:00Z', positionSharesAfter: 100,
        availableSharesAfter: 0, realizedProfit: 0, reasons: ['test'],
      }],
      cycles: [{
        id: 'cycle-a', strategyId: 'realtime', strategyVersion: '3', code: '300750',
        name: 'CATL', status: 'open', openedAt: '2026-08-07T01:30:00Z', closedAt: null,
        buyAmount: 20000, sellAmount: 0, realizedProfit: 0, returnPct: null,
        transactionIds: ['virtual-trade-a'],
      }],
    },
  }),
}));
vi.mock('./cloud-securities-repository', () => ({
  createCloudSecuritiesRepository: () => ({ executeBuy: mocks.executeBuy, executeSell: vi.fn(), executeTTradeSell: mocks.executeTTradeSell, executeTTradeBuyback: vi.fn(), resolveTTradeCycle: vi.fn() }),
}));
vi.mock('../t-trading/useTTradingState', () => ({ useTTradingState: () => ({ reload: mocks.reloadTState }) }));
vi.mock('../t-trading/TTradeExecutionDialog', () => ({ TTradeExecutionDialog: ({ onConfirm }: { onConfirm(input: unknown): void }) => <button onClick={() => onConfirm({ shares: 300, price: 11.8, brokerActualTotalFee: 6.2, resolution: 'execute' })}>确认做 T</button> }));
vi.mock('../StockTradeConfirmDialog', () => ({
  StockTradeConfirmDialog: ({ onConfirm }: { onConfirm(input: unknown): void }) => (
    <button onClick={() => onConfirm({ shares: 100, price: 10, groupId: 'core', newGroupName: '' })}>
      确认云交易
    </button>
  ),
}));

import { CloudSignalInbox } from './CloudSignalInbox';

describe('CloudSignalInbox', () => {
  beforeEach(() => {
    mocks.alerts = [{
      id: 'alert-a', code: '000001', name: '平安银行', price: 10, action: 'buy', intent: 'open',
      suggestedShares: 100, positionSharesAtSignal: 0, availableSharesAtSignal: 0,
      reasons: ['突破买点'], signalAt: '2026-08-07T01:30:00Z', status: 'pending', readAt: null,
      executedAt: null, entryPrice: 10, stopLoss: 9, metrics: {}, messageKind: 'actual_position_risk',
      virtualTrackingStatus: 'actual_risk_only', virtualTradeId: null, virtualCycleId: null,
      virtualShares: 0, virtualPrice: null, virtualPositionSharesAfter: null,
      virtualAvailableSharesAfter: null, strategyId: 'realtime', strategyVersion: '3', tTrade: null,
    }];
    mocks.executeTTradeSell.mockReset().mockResolvedValue(undefined);
    mocks.reloadTState.mockReset().mockResolvedValue(undefined);    mocks.executeBuy.mockReset().mockResolvedValue(undefined);
    mocks.reloadLedger.mockReset().mockResolvedValue(undefined);
    mocks.reloadInbox.mockReset().mockResolvedValue(undefined);
    mocks.markRead.mockReset().mockResolvedValue(undefined);
    mocks.refreshRuntime.mockReset().mockResolvedValue(undefined);
  });

  it('executes a cloud buy and refreshes both holdings and inbox', async () => {
    const user = userEvent.setup();
    render(<CloudSignalInbox />);

    await user.click(screen.getByRole('button', { name: /云端信号收件箱/ }));
    await user.click(screen.getByRole('button', { name: '执行买入' }));
    await user.click(screen.getByRole('button', { name: '确认云交易' }));

    expect(mocks.executeBuy).toHaveBeenCalledWith({
      alertId: 'alert-a', code: '000001', name: '平安银行', shares: 100, price: 10,
      groupId: 'core', groupName: '核心持仓', tradedAt: expect.any(String),
    });
    expect(mocks.reloadLedger).toHaveBeenCalledOnce();
    expect(mocks.reloadInbox).toHaveBeenCalledOnce();
  });

  it('shows the authenticated-account scan status and supports manual refresh', async () => {
    const user = userEvent.setup();
    render(<CloudSignalInbox />);

    await user.click(screen.getByRole('button', { name: /云端信号收件箱/ }));
    expect(screen.getByText('监控 6 只 · 自选 3 只 · 持仓 2 只')).toBeInTheDocument();
    expect(screen.getByText(/最后扫描：12:30:00/)).toBeInTheDocument();

    mocks.refreshRuntime.mockClear();
    await user.click(screen.getByRole('button', { name: '立即扫描当前账号股票' }));
    expect(mocks.refreshRuntime).toHaveBeenCalledOnce();
  });
  it('shows cloud virtual positions without triggering another full-account scan', async () => {
    const user = userEvent.setup();
    render(<CloudSignalInbox />);

    await user.click(screen.getAllByRole('button')[0]);

    expect(screen.getByTestId('cloud-virtual-position-300750')).toBeInTheDocument();
    expect(mocks.refreshRuntime).not.toHaveBeenCalled();
  });
  it('keeps the complete forward-simulation ledger available in cloud mode', async () => {
    const user = userEvent.setup();
    render(<CloudSignalInbox />);

    await user.click(screen.getAllByRole('button')[0]);
    await user.click(screen.getByRole('button', { name: '前向模拟记录' }));

    expect(screen.getByRole('button', { name: '查看消息 alert-a' })).toBeInTheDocument();

    window.history.replaceState({}, '', '/projects/default/securities/watchlist');
    await user.click(screen.getByRole('button', { name: '查看虚拟持仓 CATL' }));
    expect(window.location.pathname).toBe('/projects/default/securities/stock/300750');
  });
  it('executes a cloud T sell and reloads holdings, T state, and inbox', async () => {
    mocks.alerts = [{
      ...mocks.alerts[0], id: 't-sell', code: '000685', name: '中山公用', price: 11.8,
      action: 'sell', intent: 'reduce', suggestedShares: 300, positionSharesAtSignal: 1000,
      availableSharesAtSignal: 1000, messageKind: 'actual_t_sell',
      tTrade: { kind: 'actual_t_sell', cycleId: null, positionId: 'position-a', cycleType: 'profit_t',
        sellRange: [11.8, 12], buybackRange: [11.2, 11.4], targetRange: null,
        expectedNetProfit: 168, expectedRoundTripFees: 11.5, riskBuffer: 5,
        atr20: .42, atrp20: .035, support: 11.2, resistance: 11.95, volumeRatio20: 1.3,
        flowBias: 'outflow', actualSellPrice: 0, remainingBuybackShares: 0,
        expiresAt: '2026-08-11T07:00:00Z', confirmations: ['outflow'], reasons: [] },
    }];
    const user = userEvent.setup();
    render(<CloudSignalInbox />);
    await user.click(screen.getAllByRole('button')[0]);
    await user.click(screen.getByRole('button', { name: '执行做 T 卖出 中山公用' }));
    await user.click(screen.getByRole('button', { name: '确认做 T' }));

    expect(mocks.executeTTradeSell).toHaveBeenCalledWith({
      alertId: 't-sell', price: 11.8, shares: 300, tradedAt: expect.any(String),
      brokerActualTotalFee: 6.2,
    });
    expect(mocks.reloadLedger).toHaveBeenCalled();
    expect(mocks.reloadTState).toHaveBeenCalled();
    expect(mocks.reloadInbox).toHaveBeenCalled();
  });
});
