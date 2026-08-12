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
    expect(screen.getByText('行情或 K 线过期，未生成做 T 信号')).toBeInTheDocument();
  });
  it('shows foreground calculation states instead of claiming K-line data is stale', () => {
    const { rerender } = render(<TTradePositionSummary alert={null} cycle={null} foregroundStatus="loading" />);
    expect(screen.getByText('正在计算做 T 计划')).toBeInTheDocument();
    rerender(<TTradePositionSummary alert={null} cycle={null} foregroundStatus="waiting" />);
    expect(screen.getByText('已获取行情与 K 线，暂未触发做 T 条件')).toBeInTheDocument();
    rerender(<TTradePositionSummary alert={null} cycle={null} foregroundStatus="error" foregroundError="未获取到历史 K 线" />);
    expect(screen.getByText('做 T 计算失败：未获取到历史 K 线')).toBeInTheDocument();
  });
});
