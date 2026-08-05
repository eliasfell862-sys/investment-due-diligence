import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { BacktestSignalAlert } from './backtest-signal-inbox-store';
import type { StockPosition } from './stock-position-ledger';
import { StockTradeConfirmDialog } from './StockTradeConfirmDialog';

function alert(action: 'buy' | 'sell'): BacktestSignalAlert {
  return {
    id: `alert-${action}`, code: '000001', name: '平安银行', price: 10.8,
    action, intent: action === 'buy' ? 'open' : 'exit',
    suggestedShares: 100, positionSharesAtSignal: action === 'buy' ? 0 : 100,
    reasons: ['MACD金叉'], signalAt: '2026-08-04T01:30:00.000Z',
    status: 'pending', readAt: null, executedAt: null, entryPrice: 10.8, stopLoss: 9.2,
    metrics: {
      totalTrades: 12, winRate: 58, sharpeRatio: 1.1,
      maxDrawdown: 12, annualReturn: 18, profitFactor: 1.4,
    },
  };
}

function position(): StockPosition {
  return {
    id: 'position-1', groupId: 'default', code: '000001', name: '平安银行',
    shares: 300, averageCost: 10, totalCost: 3_000,
    openedAt: '2026-08-01T01:30:00.000Z', updatedAt: '2026-08-01T01:30:00.000Z',
    sourceAlertIds: ['alert-buy'],
  };
}

describe('StockTradeConfirmDialog', () => {
  it('defaults a buy to one lot, the signal price, and the default group', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<StockTradeConfirmDialog
      alert={alert('buy')}
      position={null}
      groups={[]}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />);

    expect(screen.getByRole('dialog', { name: '确认买入 平安银行' })).toBeInTheDocument();
    expect(screen.getByLabelText('交易股数')).toHaveValue(100);
    expect(screen.getByLabelText('成交价格')).toHaveValue(10.8);
    expect(screen.getByLabelText('目标持仓组')).toHaveValue('default');

    await user.click(screen.getByRole('button', { name: '确认买入' }));
    expect(onConfirm).toHaveBeenCalledWith({
      shares: 100, price: 10.8, groupId: 'default', newGroupName: '',
    });
  });

  it('allows selecting an existing group or naming a new group', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<StockTradeConfirmDialog
      alert={alert('buy')}
      position={null}
      groups={[{ id: 'long-term', name: '长期持仓' }]}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />);

    await user.selectOptions(screen.getByLabelText('目标持仓组'), '__new__');
    await user.type(screen.getByLabelText('新持仓组名称'), '波段组合');
    await user.click(screen.getByRole('button', { name: '确认买入' }));
    expect(onConfirm).toHaveBeenCalledWith({
      shares: 100, price: 10.8, groupId: '__new__', newGroupName: '波段组合',
    });
  });

  it('locks an add-on buy to the existing position group', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<StockTradeConfirmDialog
      alert={alert('buy')}
      position={position()}
      groups={[{ id: 'core', name: '核心持仓' }]}
      fixedBuyGroup={{ id: 'core', name: '核心持仓' }}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />);

    expect(screen.getByText('核心持仓')).toBeInTheDocument();
    expect(screen.queryByLabelText('目标持仓组')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认买入' }));
    expect(onConfirm).toHaveBeenCalledWith({
      shares: 100, price: 10.8, groupId: 'core', newGroupName: '',
    });
  });
  it('rejects invalid buy lots and invalid prices', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<StockTradeConfirmDialog
      alert={alert('buy')} position={null} groups={[]}
      onConfirm={onConfirm} onCancel={vi.fn()}
    />);

    await user.clear(screen.getByLabelText('交易股数'));
    await user.type(screen.getByLabelText('交易股数'), '50');
    await user.click(screen.getByRole('button', { name: '确认买入' }));
    expect(screen.getByText('买入股数必须是100股的整数倍')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('成交价格'));
    await user.type(screen.getByLabelText('成交价格'), '0');
    await user.click(screen.getByRole('button', { name: '确认买入' }));
    expect(screen.getByText('成交价格必须大于0')).toBeInTheDocument();
  });

  it('defaults a sell to the entire position and rejects partial odd-lot sales', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<StockTradeConfirmDialog
      alert={alert('sell')} position={position()}
      groups={[{ id: 'default', name: '默认持仓' }]}
      onConfirm={onConfirm} onCancel={vi.fn()}
    />);

    expect(screen.getByRole('dialog', { name: '确认卖出 平安银行' })).toBeInTheDocument();
    expect(screen.getByLabelText('交易股数')).toHaveValue(300);
    expect(screen.queryByLabelText('目标持仓组')).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('交易股数'));
    await user.type(screen.getByLabelText('交易股数'), '50');
    await user.click(screen.getByRole('button', { name: '确认卖出' }));
    expect(screen.getByRole('alert')).toHaveTextContent('卖出股数必须是100股的整数倍');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('rejects a sale larger than the current position', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<StockTradeConfirmDialog
      alert={alert('sell')} position={position()} groups={[]}
      onConfirm={onConfirm} onCancel={vi.fn()}
    />);

    await user.clear(screen.getByLabelText('交易股数'));
    await user.type(screen.getByLabelText('交易股数'), '400');
    await user.click(screen.getByRole('button', { name: '确认卖出' }));
    expect(screen.getByText('卖出股数不能超过当前持仓')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows a latest-price label and blocks duplicate submission while saving', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<StockTradeConfirmDialog
      alert={alert('buy')}
      position={null}
      groups={[]}
      priceLabel="最新价"
      submitting
      externalError="存储空间不足"
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />);

    expect(screen.getByText(/最新价 ¥10.80/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('存储空间不足');
    expect(screen.getByRole('button', { name: '提交中...' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '提交中...' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
