import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TTradeSignalCard } from './TTradeSignalCard';
import type { BacktestSignalAlertV3 } from '../backtest-signal-inbox-store';

const base = {
  id: 't-a', code: '000685', name: '中山公用', price: 11.8, action: 'sell', intent: 'reduce',
  suggestedShares: 300, positionSharesAtSignal: 1000, availableSharesAtSignal: 1000,
  reasons: ['压力位附近放量转弱'], signalAt: '2026-08-11T06:00:00Z', status: 'pending', readAt: null,
  executedAt: null, entryPrice: 11.1, stopLoss: 0, metrics: { totalTrades: 0, winRate: 0, sharpeRatio: 0, maxDrawdown: 0, annualReturn: 0, profitFactor: 0 },
  messageKind: 'actual_t_sell', virtualTrackingStatus: 'actual_risk_only', virtualTradeId: null,
  virtualCycleId: null, virtualShares: 0, virtualPrice: null, virtualPositionSharesAfter: null,
  virtualAvailableSharesAfter: null, strategyId: 'actual-t', strategyVersion: '1',
  tTrade: { kind: 'actual_t_sell', cycleId: null, positionId: 'p-a', cycleType: 'profit_t', sellRange: [11.8, 12] as [number, number], buybackRange: [11.2, 11.4] as [number, number], targetRange: null, expectedNetProfit: 168.5, expectedRoundTripFees: 11.55, riskBuffer: 5, atr20: 0.42, atrp20: 0.035, support: 11.2, resistance: 11.95, volumeRatio20: 1.35, flowBias: 'outflow', actualSellPrice: 0, remainingBuybackShares: 0, expiresAt: '2026-08-11T07:00:00Z', confirmations: ['outflow'], reasons: [] },
} satisfies BacktestSignalAlertV3;

describe('TTradeSignalCard', () => {
  it('shows fee-aware sell evidence and execution action', () => {
    render(<TTradeSignalCard alert={base} onExecute={vi.fn()} onMarkRead={vi.fn()} onViewStock={vi.fn()} />);
    expect(screen.getByText('做 T 卖出信号')).toBeInTheDocument();
    expect(screen.getByText(/预计双边费用.*11.55/)).toBeInTheDocument();
    expect(screen.getByText(/预计净收益.*168.50/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '执行做 T 卖出 中山公用' })).toBeInTheDocument();
  });

  it('does not offer a mechanical buyback for risk review', () => {
    const alert = { ...base, action: 'buy' as const, messageKind: 'actual_t_risk_review' as const,
      tTrade: { ...base.tTrade, kind: 'actual_t_risk_review' as const } };
    render(<TTradeSignalCard alert={alert} onExecute={vi.fn()} onMarkRead={vi.fn()} onViewStock={vi.fn()} />);
    expect(screen.getByText('回补暂停：风险复核')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /执行做 T/ })).not.toBeInTheDocument();
  });
  it('offers an explicit keep-as-reduction resolution for expiry risk', () => {
    const onKeepAsReduction = vi.fn();
    const alert = { ...base, action: 'buy' as const, messageKind: 'actual_t_expiry_risk' as const,
      tTrade: { ...base.tTrade, kind: 'actual_t_expiry_risk' as const, cycleId: 'cycle-a' } };
    render(<TTradeSignalCard alert={alert} onExecute={vi.fn()} onKeepAsReduction={onKeepAsReduction} onMarkRead={vi.fn()} onViewStock={vi.fn()} />);
    screen.getByRole('button', { name: '保留为减仓 中山公用' }).click();
    expect(onKeepAsReduction).toHaveBeenCalledWith(alert);
  });
});
