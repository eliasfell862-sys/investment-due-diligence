import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MediumTermBuyAdvice } from '../../engines/market-analysis/medium-term-buy-advice';
import type { WatchlistAdviceTaskState } from './watchlist-buy-advice-service';
import { WatchlistAdviceCell, WatchlistAdviceDetailRow } from './WatchlistAdviceCell';

function advice(overrides: Partial<MediumTermBuyAdvice> = {}): MediumTermBuyAdvice {
  return {
    code: '000001', horizon: '1_3_months', action: 'accumulate', label: '分批买入', score: 82,
    confidence: 90, confidenceLabel: '高', reasons: ['趋势向上'], risks: ['估值波动'],
    dataCompleteness: { quote: true, kline: true, fundamental: true },
    calculatedAt: '2026-08-04T10:00:00.000Z', ...overrides,
  };
}

function renderCell(state: WatchlistAdviceTaskState, overrides: { onRetry?: () => void } = {}) {
  return render(
    <table><tbody><tr>
      <WatchlistAdviceCell stockName="平安银行" state={state} expanded={false} onToggle={vi.fn()} onRetry={overrides.onRetry ?? vi.fn()} />
    </tr></tbody></table>,
  );
}

describe('WatchlistAdviceCell', () => {
  it('renders waiting and loading states without an actionable conclusion', () => {
    const { rerender } = render(
      <table><tbody><tr><WatchlistAdviceCell stockName="平安银行" state={{ status: 'waiting' }} expanded={false} onToggle={vi.fn()} onRetry={vi.fn()} /></tr></tbody></table>,
    );
    expect(screen.getByText('等待分析')).toBeInTheDocument();
    rerender(<table><tbody><tr><WatchlistAdviceCell stockName="平安银行" state={{ status: 'loading' }} expanded={false} onToggle={vi.fn()} onRetry={vi.fn()} /></tr></tbody></table>);
    expect(screen.getByText('分析中')).toBeInTheDocument();
  });

  it('shows label, score, and confidence for success', () => {
    renderCell({ status: 'success', advice: advice() });
    expect(screen.getByText('分批买入')).toBeInTheDocument();
    expect(screen.getByText('82分')).toBeInTheDocument();
    expect(screen.getByText('置信度：高')).toBeInTheDocument();
  });

  it('expands read-only reasons, risks, completeness, and time', () => {
    render(
      <table><tbody>
        <tr><WatchlistAdviceCell stockName="平安银行" state={{ status: 'success', advice: advice() }} expanded onToggle={vi.fn()} onRetry={vi.fn()} /></tr>
        <WatchlistAdviceDetailRow advice={advice()} colSpan={9} />
      </tbody></table>,
    );
    expect(screen.getByText('主要依据')).toBeInTheDocument();
    expect(screen.getByText('主要风险')).toBeInTheDocument();
    expect(screen.getByText(/K线：完整/)).toBeInTheDocument();
    expect(screen.getByText(/基本面：完整/)).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: /主要依据/ })).toHaveAttribute('colspan', '9');
  });

  it('stops row propagation when toggling advice', async () => {
    const rowClick = vi.fn();
    const onToggle = vi.fn();
    render(<table><tbody><tr onClick={rowClick}><WatchlistAdviceCell stockName="平安银行" state={{ status: 'success', advice: advice() }} expanded={false} onToggle={onToggle} onRetry={vi.fn()} /></tr></tbody></table>);
    await userEvent.click(screen.getByRole('button', { name: '查看平安银行中线建议' }));
    expect(onToggle).toHaveBeenCalledOnce();
    expect(rowClick).not.toHaveBeenCalled();
  });

  it('offers an isolated retry for error state', async () => {
    const onRetry = vi.fn();
    renderCell({ status: 'error', error: 'network' }, { onRetry });
    await userEvent.click(screen.getByRole('button', { name: '重试平安银行建议' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
