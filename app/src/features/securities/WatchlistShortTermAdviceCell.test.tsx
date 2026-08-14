import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ShortTermTradingAdvice } from '../../engines/market-analysis/short-term-trading-advice';
import type { WatchlistShortTermTaskState } from './watchlist-short-term-advice-service';
import type { CalibrationHookState } from './watchlist-short-term-calibration/useWatchlistShortTermCalibration';
import {
  WatchlistShortTermAdviceCell,
  WatchlistShortTermAdviceDetailRow,
} from './WatchlistShortTermAdviceCell';


const calibration: CalibrationHookState = {
  status: 'ready', result: null, progress: null, error: '', stale: false,
  recalibrate: vi.fn(async () => undefined),
};
function advice(overrides: Partial<ShortTermTradingAdvice> = {}): ShortTermTradingAdvice {
  return {
    code: '000001', horizon: '3_10_trading_days', action: 'buy_on_dip', label: '逢低买入', score: 75,
    confidence: 82, confidenceLabel: '高', entryRange: { low: 10, high: 10.2 }, stopLoss: 9.5,
    takeProfit1: 11.25, takeProfit2: 11.8, maxHoldingTradingDays: 7, riskRewardRatio: 1.65,
    reasons: ['短期均线保持多头结构'], risks: ['接近前期压力位'],
    evidence: ['收盘10.10；MA5 10.00，MA10 9.90，MA20 9.80', 'MACD：DIF 0.20，DEA 0.10；RSI6 60.00；KDJ-J 70.00', '涨跌幅 +1.20%；量比 1.30；换手率 2.00%'],
    dataCompleteness: { quote: true, kline: true, indicators: true, strategies: true },
    dataAsOf: '2026-08-04T10:00:00.000Z', calculatedAt: '2026-08-04T10:00:01.000Z',
    cacheStatus: 'fresh', ...overrides,
  };
}

function renderCell(state: WatchlistShortTermTaskState, onRetry = vi.fn()) {
  return render(
    <table><tbody><tr>
      <WatchlistShortTermAdviceCell
        stockName="平安银行" state={state} expanded={false} onToggle={vi.fn()} onRetry={onRetry}
      />
    </tr></tbody></table>,
  );
}

describe('WatchlistShortTermAdviceCell', () => {
  it('shows the action and executable prices', () => {
    renderCell({ status: 'success', advice: advice() });
    expect(screen.getByText('买入')).toBeInTheDocument();
    expect(screen.getByText('75分 · 高')).toBeInTheDocument();
    expect(screen.getByText('买入 10.00–10.20')).toBeInTheDocument();
    expect(screen.getByText('止损 9.50 · 止盈 11.25')).toBeInTheDocument();
  });

  it.each([
    ['strong_buy', '\u4e70\u5165'],
    ['buy_on_dip', '\u4e70\u5165'],
    ['hold_watch', '\u89c2\u671b'],
    ['avoid', '\u56de\u907f'],
    ['reduce_sell', '\u56de\u907f'],
    ['insufficient_data', '\u89c2\u671b'],
  ] as const)('maps %s to the three-state label %s', (action, label) => {
    renderCell({ status: 'success', advice: advice({ action }) });
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('renders waiting, loading, and isolated retry states', async () => {
    const { rerender } = renderCell({ status: 'waiting' });
    expect(screen.getByText('等待分析')).toBeInTheDocument();
    rerender(<table><tbody><tr><WatchlistShortTermAdviceCell stockName="平安银行" state={{ status: 'loading' }} expanded={false} onToggle={vi.fn()} onRetry={vi.fn()} /></tr></tbody></table>);
    expect(screen.getByText('分析中')).toBeInTheDocument();
    const onRetry = vi.fn();
    rerender(<table><tbody><tr><WatchlistShortTermAdviceCell stockName="平安银行" state={{ status: 'error', error: 'network' }} expanded={false} onToggle={vi.fn()} onRetry={onRetry} /></tr></tbody></table>);
    await userEvent.click(screen.getByRole('button', { name: '重试平安银行短线建议' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('does not bubble its toggle to the stock row', async () => {
    const rowClick = vi.fn();
    const onToggle = vi.fn();
    render(<table><tbody><tr onClick={rowClick}><WatchlistShortTermAdviceCell stockName="平安银行" state={{ status: 'success', advice: advice() }} expanded={false} onToggle={onToggle} onRetry={vi.fn()} /></tr></tbody></table>);
    await userEvent.click(screen.getByRole('button', { name: '查看平安银行短线建议' }));
    expect(onToggle).toHaveBeenCalledOnce();
    expect(rowClick).not.toHaveBeenCalled();
  });

  it('shows detailed targets, risk reward, holding days, and cached status', () => {
    render(<table><tbody><WatchlistShortTermAdviceDetailRow advice={advice({ cacheStatus: 'cached' })} colSpan={10} calibration={calibration} /></tbody></table>);
    expect(screen.getByText(/第二止盈：11.80/)).toBeInTheDocument();
    expect(screen.getByText(/风险收益比：1.65/)).toBeInTheDocument();
    expect(screen.getByText(/最长持有：7个交易日/)).toBeInTheDocument();
    expect(screen.getByText('信息依据')).toBeInTheDocument();
    expect(screen.getByText(/MACD：DIF 0.20/)).toBeInTheDocument();
    expect(screen.getByText(/基于缓存/)).toBeInTheDocument();
    expect(screen.getByText('短线历史校准')).toBeInTheDocument();
    expect(screen.getByRole('cell')).toHaveAttribute('colspan', '10');
  });
});
