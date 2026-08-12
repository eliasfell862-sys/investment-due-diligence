import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TTradePositionSummary } from './TTradePositionSummary';

describe('TTradePositionSummary', () => {
  it('shows a pending fee-aware sell plan', () => {
    render(<TTradePositionSummary alert={{ kind: 'actual_t_sell', shares: 300, sellRange: [11.8, 12], buybackRange: [11.2, 11.4] }} cycle={null} />);
    expect(screen.getByText(/卖出 300 股/)).toBeInTheDocument();
    expect(screen.getByText(/11.80–12.00/)).toBeInTheDocument();
    expect(screen.getByText(/11.20–11.40/)).toBeInTheDocument();
  });

  it('shows active and paused cycle states', () => {
    const { rerender } = render(<TTradePositionSummary alert={null} cycle={{ status: 'partially_bought_back', soldShares: 300, remainingBuybackShares: 200, realizedTProfit: 93 }} />);
    expect(screen.getByText(/已卖 300.*待回补 200/)).toBeInTheDocument();
    rerender(<TTradePositionSummary alert={null} cycle={{ status: 'buyback_paused_risk_review', soldShares: 300, remainingBuybackShares: 300, realizedTProfit: 0 }} />);
    expect(screen.getByText('回补已暂停，等待风险复核')).toBeInTheDocument();
  });

  it('distinguishes insufficient samples from no current signal', () => {
    const { rerender } = render(<TTradePositionSummary alert={null} cycle={null} sampleInsufficient />);
    expect(screen.getByText('样本不足，使用保守参数')).toBeInTheDocument();
    rerender(<TTradePositionSummary alert={null} cycle={null} />);
    expect(screen.getByText('正在等待做 T 计算')).toBeInTheDocument();
  });
});