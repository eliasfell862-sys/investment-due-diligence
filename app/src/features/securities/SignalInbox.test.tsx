import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { BacktestSignalAlertV3 } from './backtest-signal-inbox-store';
import type { StockPositionLedger, StockTransaction } from './stock-position-ledger';

const mocks = vi.hoisted(() => ({
  monitor: {} as any,
  useMonitorContext: vi.fn(),
  loadStockLedger: vi.fn(),
  buyStockPosition: vi.fn(),
  sellStockPosition: vi.fn(),
}));

vi.mock('./RealtimeBacktestMonitorProvider', () => ({
  useRealtimeBacktestMonitorContext: mocks.useMonitorContext,
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

type Intent = BacktestSignalAlertV3['intent'];

function signalAlert(intent: Intent, overrides: Partial<BacktestSignalAlertV3> = {}): BacktestSignalAlertV3 {
  const action = intent === 'open' || intent === 'add' ? 'buy' : 'sell';
  const suggestedShares = intent === 'reduce' ? 200 : intent === 'exit' ? 1_000 : 100;
  return {
    id: `alert-${intent}`, code: '000001', name: '平安银行', price: 10.8,
    action, intent, suggestedShares,
    positionSharesAtSignal: action === 'buy' ? 0 : 1_000,
    reasons: [action === 'buy' ? 'MACD金叉' : 'MACD死叉'],
    signalAt: '2026-08-05T01:30:00.000Z', status: 'pending', readAt: null, executedAt: null,
    entryPrice: 10.8, stopLoss: 9.2,
    metrics: {
      totalTrades: 12, winRate: 58, sharpeRatio: 1.1,
      maxDrawdown: 12, annualReturn: 18, profitFactor: 1.4,
    },
    messageKind: 'virtual_execution',
    virtualTrackingStatus: 'executed',
    virtualTradeId: 'virtual-trade-1',
    virtualCycleId: 'virtual-cycle-1',
    virtualShares: suggestedShares,
    virtualPrice: 10.8,
    virtualPositionSharesAfter: intent === 'exit' ? 0 : intent === 'reduce' ? 800 : 100,
    virtualAvailableSharesAfter: intent === 'open' || intent === 'add' ? 0 : 800,
    strategyId: 'realtime-technical',
    strategyVersion: '1',
    ...overrides,
    availableSharesAtSignal: overrides.availableSharesAtSignal
      ?? overrides.positionSharesAtSignal
      ?? (action === 'buy' ? 0 : 1_000),
  };
}

function ledger(
  shares = 0,
  groupId = 'core',
  transactions: StockTransaction[] = [],
): StockPositionLedger {
  return {
    version: 1,
    groups: [{ id: 'default', name: '默认持仓' }, { id: 'core', name: '核心持仓' }],
    positions: shares > 0 ? [{
      id: 'position-1', groupId, code: '000001', name: '平安银行',
      shares, averageCost: 10, totalCost: shares * 10,
      openedAt: '2026-08-01T01:30:00.000Z', updatedAt: '2026-08-01T01:30:00.000Z',
      sourceAlertIds: ['alert-open'],
    }] : [],
    transactions,
  };
}

function buyTransaction(overrides: Partial<StockTransaction> = {}): StockTransaction {
  return {
    id: 'transaction-buy', groupId: 'core', code: '000001', name: '平安银行',
    type: 'buy', shares: 200, price: 10, amount: 2_000,
    tradedAt: '2026-08-05T01:30:00.000Z', sourceAlertId: 'buy-today', realizedProfit: 0,
    ...overrides,
  };
}
function setupMonitor(alerts: BacktestSignalAlertV3[]) {
  mocks.monitor = {
    alerts,
    unreadCount: alerts.filter(alert => !alert.readAt).length,
    checking: false,
    partialFailureCount: 1,
    monitoringCount: 36,
    watchlistCount: 36,
    heldCount: 2,
    successfulCount: 35,
    lastScanAt: '2026-08-05T01:30:00.000Z',
    marketStatus: 'trading',
    lastUpdatedAt: '2026-08-05T01:30:00.000Z',
    error: '',
    runtime: { version: 3, alerts, stocks: {}, virtualLedger: { version: 1, positions: [], transactions: [], cycles: [] } },
    virtualLedger: { version: 1, positions: [], transactions: [], cycles: [] },
    prices: { '000001': 10.8 },
    refreshNow: vi.fn().mockResolvedValue(undefined),
    markRead: vi.fn(),
    markExecuted: vi.fn(),
    clearAlerts: vi.fn(),
    reloadLedger: vi.fn(),
  };
  mocks.useMonitorContext.mockImplementation(() => mocks.monitor);
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

async function openInbox(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTitle('实时回测买卖信号'));
}

async function openTrade(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('button', { name: label }));
}

describe('SignalInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMonitor([]);
    mocks.loadStockLedger.mockReturnValue(ledger());
    mocks.buyStockPosition.mockReturnValue({ ledger: ledger(300), position: ledger(300).positions[0] });
    mocks.sellStockPosition.mockReturnValue({ ledger: ledger(), position: null });
  });

  it('uses the global monitor context and shows diagnostics plus all four intent summaries', async () => {
    const user = userEvent.setup();
    setupMonitor([
      signalAlert('open'), signalAlert('add'), signalAlert('reduce'), signalAlert('exit'),
    ]);
    mocks.loadStockLedger.mockReturnValue(ledger(1_000));
    renderInbox();

    await openInbox(user);
    expect(mocks.useMonitorContext).toHaveBeenCalled();
    expect(screen.getByText('监控36只 · 自选36只 · 持仓2只')).toBeInTheDocument();
    expect(screen.getByText('成功35只 · 失败1只')).toBeInTheDocument();
    expect(screen.getByText(/网站打开期间持续监听/)).toBeInTheDocument();
    expect(screen.getByText('首次买入 · 建议 100 股 · 触发价 ¥10.80')).toBeInTheDocument();
    expect(screen.getByText('补仓 · 建议 100 股 · 触发价 ¥10.80')).toBeInTheDocument();
    expect(screen.getByText('部分卖出 · 建议 200 股 · 触发价 ¥10.80')).toBeInTheDocument();
    expect(screen.getByText('全部卖出 · 建议 1,000 股 · 触发价 ¥10.80')).toBeInTheDocument();
  });

  it('shows linked virtual execution details without confusing them with actual execution', async () => {
    const user = userEvent.setup();
    setupMonitor([signalAlert('open', {
      price: 12.34,
      suggestedShares: 100,
      virtualShares: 100,
      virtualPrice: 12.34,
      virtualPositionSharesAfter: 100,
    })]);
    renderInbox();

    await openInbox(user);

    expect(screen.getByText('虚拟已买入')).toBeInTheDocument();
    expect(screen.getByText(/虚拟成交 100 股 · ¥12.34/)).toBeInTheDocument();
    expect(screen.getByText(/虚拟持仓 100 股/)).toBeInTheDocument();
    await user.click(screen.getByText('交易关联'));
    expect(screen.getByText(/virtual-trade-1/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '执行首次买入 平安银行' })).toBeEnabled();
  });

  it('labels legacy, T+1 blocked and actual-position-only messages explicitly', async () => {
    const user = userEvent.setup();
    setupMonitor([
      signalAlert('open', {
        id: 'legacy',
        messageKind: 'legacy',
        virtualTrackingStatus: 'legacy_untracked',
        virtualTradeId: null,
        virtualCycleId: null,
        virtualShares: 0,
        virtualPrice: null,
        virtualPositionSharesAfter: null,
        virtualAvailableSharesAfter: null,
      }),
      signalAlert('reduce', {
        id: 'blocked',
        messageKind: 'virtual_blocked',
        virtualTrackingStatus: 'blocked_t1',
        virtualTradeId: null,
        virtualShares: 0,
      }),
      signalAlert('reduce', {
        id: 'actual-risk',
        messageKind: 'actual_position_risk',
        virtualTrackingStatus: 'actual_risk_only',
        virtualTradeId: null,
        virtualCycleId: null,
        virtualShares: 0,
        virtualPrice: null,
        virtualPositionSharesAfter: null,
        virtualAvailableSharesAfter: null,
      }),
    ]);
    mocks.loadStockLedger.mockReturnValue(ledger(1_000));
    renderInbox();

    await openInbox(user);

    expect(screen.getByText('历史信号，未纳入虚拟交易')).toBeInTheDocument();
    expect(screen.getByText('卖出受T+1限制')).toBeInTheDocument();
    expect(screen.getByText('实际持仓风控提醒')).toBeInTheDocument();
    expect(screen.queryByText('虚拟已部分卖出')).not.toBeInTheDocument();
  });

  it('switches between message and forward-simulation records without leaving the inbox', async () => {
    const user = userEvent.setup();
    setupMonitor([]);
    renderInbox();

    await openInbox(user);
    expect(screen.getByRole('button', { name: '消息' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '前向模拟记录' }));

    expect(screen.getByText('当前虚拟持仓')).toBeInTheDocument();
    expect(screen.getByText('暂无未平仓虚拟持仓')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '前向模拟记录' })).toBeDisabled();
  });

  it('opens a new position with an edited quantity and selected existing group before marking executed', async () => {
    const user = userEvent.setup();
    setupMonitor([signalAlert('open')]);
    renderInbox();

    await openInbox(user);
    await openTrade(user, '执行首次买入 平安银行');
    await user.clear(screen.getByLabelText('交易股数'));
    await user.type(screen.getByLabelText('交易股数'), '300');
    await user.selectOptions(screen.getByLabelText('目标持仓组'), 'core');
    await user.click(screen.getByRole('button', { name: '确认买入' }));

    expect(mocks.buyStockPosition).toHaveBeenCalledWith(expect.objectContaining({
      shares: 300, groupId: 'core', groupName: '核心持仓', price: 10.8,
    }));
    expect(mocks.buyStockPosition.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.monitor.markExecuted.mock.invocationCallOrder[0]);
    expect(mocks.monitor.markExecuted).toHaveBeenCalledWith('alert-open', 'bought', true);
  });

  it('can create a new group for a first buy', async () => {
    const user = userEvent.setup();
    setupMonitor([signalAlert('open')]);
    renderInbox();

    await openInbox(user);
    await openTrade(user, '执行首次买入 平安银行');
    await user.selectOptions(screen.getByLabelText('目标持仓组'), '__new__');
    await user.type(screen.getByLabelText('新持仓组名称'), '短线组合');
    await user.click(screen.getByRole('button', { name: '确认买入' }));

    expect(mocks.buyStockPosition).toHaveBeenCalledWith(expect.objectContaining({
      groupId: expect.stringMatching(/^group-/), groupName: '短线组合',
    }));
  });

  it('locks an add trade to the existing group', async () => {
    const user = userEvent.setup();
    setupMonitor([signalAlert('add')]);
    mocks.loadStockLedger.mockReturnValue(ledger(500, 'core'));
    mocks.buyStockPosition.mockReturnValue({ ledger: ledger(600, 'core'), position: ledger(600, 'core').positions[0] });
    renderInbox();

    await openInbox(user);
    await openTrade(user, '执行补仓 平安银行');
    const dialog = screen.getByRole('dialog', { name: '确认补仓 平安银行' });
    expect(within(dialog).getByText('核心持仓')).toBeInTheDocument();
    expect(screen.queryByLabelText('目标持仓组')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认补仓' }));

    expect(mocks.buyStockPosition).toHaveBeenCalledWith(expect.objectContaining({
      shares: 100, groupId: 'core', groupName: '核心持仓',
    }));
  });

  it('reduces a position by the frozen partial quantity', async () => {
    const user = userEvent.setup();
    setupMonitor([signalAlert('reduce')]);
    mocks.loadStockLedger.mockReturnValue(ledger(1_000));
    mocks.sellStockPosition.mockReturnValue({ ledger: ledger(800), position: ledger(800).positions[0] });
    renderInbox();

    await openInbox(user);
    await openTrade(user, '执行部分卖出 平安银行');
    expect(screen.getByLabelText('交易股数')).toHaveValue(200);
    await user.click(screen.getByRole('button', { name: '确认部分卖出' }));

    expect(mocks.sellStockPosition).toHaveBeenCalledWith(expect.objectContaining({ shares: 200 }));
    expect(mocks.monitor.markExecuted).toHaveBeenCalledWith('alert-reduce', 'sold', true);
  });

  it('exits the full current position', async () => {
    const user = userEvent.setup();
    setupMonitor([signalAlert('exit')]);
    mocks.loadStockLedger.mockReturnValue(ledger(1_000));
    renderInbox();

    await openInbox(user);
    await openTrade(user, '执行全部卖出 平安银行');
    expect(screen.getByLabelText('交易股数')).toHaveValue(1_000);
    await user.click(screen.getByRole('button', { name: '确认全部卖出' }));

    expect(mocks.sellStockPosition).toHaveBeenCalledWith(expect.objectContaining({ shares: 1_000 }));
    expect(mocks.monitor.markExecuted).toHaveBeenCalledWith('alert-exit', 'sold', false);
  });

  it('caps a stale sell suggestion to the current board-lot position and explains the adjustment', async () => {
    const user = userEvent.setup();
    setupMonitor([signalAlert('reduce', { suggestedShares: 500 })]);
    mocks.loadStockLedger.mockReturnValue(ledger(300));
    renderInbox();

    await openInbox(user);
    await openTrade(user, '执行部分卖出 平安银行');
    expect(screen.getByLabelText('交易股数')).toHaveValue(300);
    expect(screen.getByText('当前可用持仓少于历史建议数量，已调整为最多可卖 300 股。')).toBeInTheDocument();
  });

  it('caps a historical sell suggestion to current available shares', async () => {
    const user = userEvent.setup();
    vi.setSystemTime('2026-08-05T06:00:00.000Z');
    setupMonitor([signalAlert('reduce', { suggestedShares: 500 })]);
    mocks.loadStockLedger.mockReturnValue(ledger(500, 'core', [buyTransaction()]));
    renderInbox();

    await openInbox(user);
    await openTrade(user, '执行部分卖出 平安银行');
    expect(screen.getByLabelText('交易股数')).toHaveValue(300);
  });

  it('disables a sell signal when current available shares are zero', async () => {
    const user = userEvent.setup();
    vi.setSystemTime('2026-08-05T06:00:00.000Z');
    setupMonitor([signalAlert('exit', { suggestedShares: 100 })]);
    mocks.loadStockLedger.mockReturnValue(ledger(100, 'core', [buyTransaction({ shares: 100, amount: 1_000 })]));
    renderInbox();

    await openInbox(user);
    expect(screen.getByRole('button', { name: '执行全部卖出 平安银行' })).toBeDisabled();
  });

  it('marks a sell executed with a remaining frozen position', async () => {
    const user = userEvent.setup();
    vi.setSystemTime('2026-08-05T06:00:00.000Z');
    setupMonitor([signalAlert('exit', { suggestedShares: 500 })]);
    mocks.loadStockLedger.mockReturnValue(ledger(500, 'core', [buyTransaction()]));
    const remaining = ledger(200, 'core', [buyTransaction()]);
    mocks.sellStockPosition.mockReturnValue({ ledger: remaining, position: remaining.positions[0] });
    renderInbox();

    await openInbox(user);
    await openTrade(user, '执行全部卖出 平安银行');
    await user.click(screen.getByRole('button', { name: '确认全部卖出' }));
    expect(mocks.sellStockPosition).toHaveBeenCalledWith(expect.objectContaining({ shares: 300 }));
    expect(mocks.monitor.markExecuted).toHaveBeenCalledWith('alert-exit', 'sold', true);
  });
  it('keeps the dialog open and does not mark executed when ledger persistence fails', async () => {
    const user = userEvent.setup();
    setupMonitor([signalAlert('open')]);
    mocks.buyStockPosition.mockImplementation(() => { throw new Error('存储空间不足'); });
    renderInbox();

    await openInbox(user);
    await openTrade(user, '执行首次买入 平安银行');
    await user.click(screen.getByRole('button', { name: '确认买入' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('存储空间不足');
    expect(screen.getByRole('dialog', { name: '确认买入 平安银行' })).toBeInTheDocument();
    expect(mocks.monitor.markExecuted).not.toHaveBeenCalled();
  });
});
