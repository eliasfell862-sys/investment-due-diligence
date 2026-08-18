import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { VirtualTradingLedger } from './virtual-trading-ledger';
import { ForwardSimulationPanel } from './ForwardSimulationPanel';

function sampleLedger(): VirtualTradingLedger {
  return {
    version: 2,
    cashAccount: {
      initialCapital: 200000, cashBalance: 198000, reservedCash: 0,
      version: 2, updatedAt: '2026-08-05T02:00:00.000Z',
    },
    requiresCapitalCleanup: false,
    positions: [{
      id: 'position-1', cycleId: 'cycle-open',
      strategyId: 'realtime-technical', strategyVersion: '1',
      code: '000001', name: '平安银行', shares: 100,
      averageCost: 10, totalCost: 1000,
      openedAt: '2026-08-05T02:00:00.000Z', updatedAt: '2026-08-05T02:00:00.000Z',
      sourceTradeIds: ['buy-1'],
    }],
    transactions: [
      {
        id: 'buy-1', sourceSignalId: 'alert-buy-1', cycleId: 'cycle-open',
        strategyId: 'realtime-technical', strategyVersion: '1',
        code: '000001', name: '平安银行', type: 'buy', intent: 'open',
        shares: 100, price: 10, amount: 1000, tradedAt: '2026-08-05T02:00:00.000Z',
        positionSharesAfter: 100, availableSharesAfter: 0, realizedProfit: 0, reasons: ['MACD金叉'],
      },
      {
        id: 'sell-1', sourceSignalId: 'alert-sell-1', cycleId: 'cycle-closed',
        strategyId: 'realtime-technical', strategyVersion: '1',
        code: '600000', name: '浦发银行', type: 'sell', intent: 'exit',
        shares: 100, price: 11, amount: 1100, tradedAt: '2026-08-04T02:00:00.000Z',
        positionSharesAfter: 0, availableSharesAfter: 0, realizedProfit: 100, reasons: ['止盈'],
      },
    ],
    cycles: [
      {
        id: 'cycle-open', strategyId: 'realtime-technical', strategyVersion: '1',
        code: '000001', name: '平安银行', status: 'open',
        openedAt: '2026-08-05T02:00:00.000Z', closedAt: null,
        buyAmount: 1000, sellAmount: 0, realizedProfit: 0, returnPct: null,
        transactionIds: ['buy-1'],
      },
      {
        id: 'cycle-closed', strategyId: 'realtime-technical', strategyVersion: '1',
        code: '600000', name: '浦发银行', status: 'closed',
        openedAt: '2026-08-01T02:00:00.000Z', closedAt: '2026-08-04T02:00:00.000Z',
        buyAmount: 1000, sellAmount: 1100, realizedProfit: 100, returnPct: 10,
        transactionIds: ['sell-1'],
      },
    ],
  };
}

describe('ForwardSimulationPanel', () => {
  it('shows shared capital separately from market value', () => {
    render(
      <ForwardSimulationPanel
        ledger={sampleLedger()}
        prices={{ '000001': 12 }}
        onViewStock={vi.fn()}
        onViewAlert={vi.fn()}
      />,
    );

    expect(screen.getByText('初始本金')).toBeInTheDocument();
    expect(screen.getByText('¥200,000.00')).toBeInTheDocument();
    expect(screen.getByText('可用现金')).toBeInTheDocument();
    expect(screen.getByText('¥198,000.00')).toBeInTheDocument();
    expect(screen.getByText('已投入成本')).toBeInTheDocument();
    expect(screen.getByText('当前市值')).toBeInTheDocument();
    expect(screen.getByText('资金使用率')).toBeInTheDocument();
    expect(screen.getByText('开放 T 周期')).toBeInTheDocument();
  });

  it('shows separate realized, unrealized and total profit', () => {
    render(
      <ForwardSimulationPanel
        ledger={sampleLedger()}
        prices={{ '000001': 12 }}
        onViewStock={vi.fn()}
        onViewAlert={vi.fn()}
      />,
    );

    expect(screen.getByText('已实现盈亏')).toBeInTheDocument();
    expect(screen.getByText('¥100.00')).toBeInTheDocument();
    expect(screen.getByText('未实现盈亏')).toBeInTheDocument();
    expect(screen.getByText('¥200.00')).toBeInTheDocument();
    expect(screen.getByText('总盈亏')).toBeInTheDocument();
    expect(screen.getByText('¥300.00')).toBeInTheDocument();
  });

  it('counts only closed cycles in the displayed win rate', () => {
    render(
      <ForwardSimulationPanel
        ledger={sampleLedger()}
        prices={{}}
        onViewStock={vi.fn()}
        onViewAlert={vi.fn()}
      />,
    );

    expect(screen.getByText('胜率 100.00%')).toBeInTheDocument();
    expect(screen.getByText('已结束周期 1')).toBeInTheDocument();
    expect(screen.getByText('未平仓 1')).toBeInTheDocument();
  });

  it('shows positions and lets users inspect transaction and cycle records', async () => {
    const user = userEvent.setup();
    const onViewStock = vi.fn();
    const onViewAlert = vi.fn();
    render(
      <ForwardSimulationPanel
        ledger={sampleLedger()}
        prices={{ '000001': 12 }}
        onViewStock={onViewStock}
        onViewAlert={onViewAlert}
      />,
    );

    expect(screen.getByText('当前虚拟持仓')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '查看虚拟持仓 平安银行' }));
    expect(onViewStock).toHaveBeenCalledWith('000001');

    expect(screen.getByText('alert-buy-1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '查看消息 alert-buy-1' }));
    expect(onViewAlert).toHaveBeenCalledWith('alert-buy-1');

    await user.click(screen.getByRole('button', { name: '完整周期' }));
    expect(screen.getByText('已结束 · 收益率 10.00%')).toBeInTheDocument();
    expect(screen.getByText('进行中')).toBeInTheDocument();
  });
});
