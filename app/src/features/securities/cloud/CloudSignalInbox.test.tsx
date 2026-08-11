import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeBuy: vi.fn(), reloadLedger: vi.fn(), reloadInbox: vi.fn(), markRead: vi.fn(),
  refreshRuntime: vi.fn(),
}));

vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'user-a' } }) }));
vi.mock('./useCloudSignalInbox', () => ({
  useCloudSignalInbox: () => ({
    alerts: [{
      id: 'alert-a', code: '000001', name: '平安银行', price: 10, action: 'buy', intent: 'open',
      suggestedShares: 100, positionSharesAtSignal: 0, availableSharesAtSignal: 0,
      reasons: ['突破买点'], signalAt: '2026-08-07T01:30:00Z', status: 'pending', readAt: null,
      executedAt: null, entryPrice: 10, stopLoss: 9, metrics: {}, messageKind: 'actual_position_risk',
      virtualTrackingStatus: 'actual_risk_only', virtualTradeId: null, virtualCycleId: null,
      virtualShares: 0, virtualPrice: null, virtualPositionSharesAfter: null,
      virtualAvailableSharesAfter: null, strategyId: 'realtime', strategyVersion: '3',
    }],
    loading: false, error: '', unreadCount: 1, reload: mocks.reloadInbox, markRead: mocks.markRead,
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
    virtualLedger: {
      version: 1,
      positions: [{
        id: 'virtual-a', cycleId: 'cycle-a', strategyId: 'realtime', strategyVersion: '3',
        code: '300750', name: 'CATL', shares: 100, averageCost: 200, totalCost: 20000,
        openedAt: '2026-08-07T01:30:00Z', updatedAt: '2026-08-07T01:30:00Z',
        sourceTradeIds: ['trade-a'],
      }],
      transactions: [], cycles: [],
    },
  }),
}));
vi.mock('./cloud-securities-repository', () => ({
  createCloudSecuritiesRepository: () => ({ executeBuy: mocks.executeBuy, executeSell: vi.fn() }),
}));
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
    mocks.executeBuy.mockReset().mockResolvedValue(undefined);
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

  it('shows cloud virtual positions in the opened inbox', async () => {
    const user = userEvent.setup();
    render(<CloudSignalInbox />);

    await user.click(screen.getAllByRole('button')[0]);

    expect(screen.getByTestId('cloud-virtual-position-300750')).toBeInTheDocument();
    expect(mocks.refreshRuntime).toHaveBeenCalled();
  });
});
