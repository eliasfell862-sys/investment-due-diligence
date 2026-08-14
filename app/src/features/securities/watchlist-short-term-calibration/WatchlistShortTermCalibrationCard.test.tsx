import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { aggregateCalibrationResult } from './aggregate';
import type { CalibrationTrade } from './types';
import type { CalibrationHookState } from './useWatchlistShortTermCalibration';
import { WatchlistShortTermCalibrationCard } from './WatchlistShortTermCalibrationCard';

const fee = {
  commission: 0, stampDuty: 0, transferFee: 0, modeledSlippage: 0,
  total: 0, source: 'profile_calculated' as const,
};

function trade(index: number, action: CalibrationTrade['action'], won = true): CalibrationTrade {
  return {
    kind: 'trade', code: String(index).padStart(6, '0'), action,
    signalDate: '2026-01-01', entryDate: '2026-01-02', entryPrice: 10,
    exitDate: `2026-02-${String(index % 28 + 1).padStart(2, '0')}`,
    exitPrice: won ? 11 : 9, shares: 100,
    exitReason: won ? 'take_profit_1' : 'stop_loss', secondTakeProfitReached: false,
    buyFees: fee, sellFees: fee, grossPnl: won ? 100 : -100,
    netPnl: won ? 100 : -100, netReturnPct: won ? 10 : -10, won,
  };
}

function calibrationResult(completed = 2, proxy = false) {
  const trades = Array.from({ length: completed }, (_, index) =>
    trade(index, 'buy_on_dip', index % 2 === 0));
  return aggregateCalibrationResult({
    trades,
    unfilled: [{ kind: 'unfilled', code: '600000', signalDate: '2026-01-01', action: 'buy_on_dip' }],
    totalStocks: 2,
    validStocks: [
      { code: '600000', turnoverMode: 'direct' },
      { code: '000001', turnoverMode: proxy ? 'proxy' : 'direct' },
    ],
    skippedStocks: [], dataAsOf: '2026-08-14', leakageBlocked: false,
    createdAt: '2026-08-14T12:00:00.000Z',
  });
}

function state(overrides: Partial<CalibrationHookState> = {}): CalibrationHookState {
  return {
    status: 'ready', result: calibrationResult(), progress: null,
    error: '', stale: false, recalibrate: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('WatchlistShortTermCalibrationCard', () => {
  it('explains that non-buy advice does not use buy win-rate evidence', () => {
    render(<WatchlistShortTermCalibrationCard action="hold_watch" state={state()} />);
    expect(screen.getByText('当前不是买入信号，不适用买入胜率')).toBeInTheDocument();
  });

  it('shows overall fallback, fill rate, fee-adjusted win rate and data scope separately', () => {
    render(<WatchlistShortTermCalibrationCard action="buy_on_dip" state={state()} />);
    expect(screen.getByText('总体样本降级')).toBeInTheDocument();
    expect(screen.getByText('信号成交率')).toBeInTheDocument();
    expect(screen.getByText('66.67%')).toBeInTheDocument();
    expect(screen.getByText('费用后胜率')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText(/直接口径 2只/)).toBeInTheDocument();
  });

  it('uses the action group after 20 completed trades', () => {
    render(<WatchlistShortTermCalibrationCard
      action="buy_on_dip"
      state={state({ result: calibrationResult(20) })}
    />);
    expect(screen.getByText('当前信号分组')).toBeInTheDocument();
    expect(screen.getByText(/20笔成交/)).toBeInTheDocument();
  });

  it('shows proxy evidence limits and running progress without hiding old metrics', () => {
    render(<WatchlistShortTermCalibrationCard
      action="buy_on_dip"
      state={state({
        status: 'running', result: calibrationResult(2, true),
        progress: { completed: 1, total: 2, currentCode: '600000' },
      })}
    />);
    expect(screen.getByText('已处理 1 / 2')).toBeInTheDocument();
    expect(screen.getByText(/代理口径 1只/)).toBeInTheDocument();
    expect(screen.getByText(/可信度最高为初步证据/)).toBeInTheDocument();
    expect(screen.getByText('费用后胜率')).toBeInTheDocument();
  });

  it('allows the user to manually recalibrate', () => {
    const recalibrate = vi.fn(async () => undefined);
    render(<WatchlistShortTermCalibrationCard action="buy_on_dip" state={state({ recalibrate })} />);
    fireEvent.click(screen.getByRole('button', { name: '重新校准' }));
    expect(recalibrate).toHaveBeenCalledOnce();
  });

  it('shows stale, error and local persistence warnings without discarding old evidence', () => {
    const result = calibrationResult();
    result.persistenceWarning = '本次结果可查看，但无法持久保存到本机';
    render(<WatchlistShortTermCalibrationCard
      action="buy_on_dip"
      state={state({ result, status: 'error', stale: true, error: '历史数据加载失败' })}
    />);
    expect(screen.getByText('结果已过期')).toBeInTheDocument();
    expect(screen.getByText('历史数据加载失败')).toBeInTheDocument();
    expect(screen.getByText('本次结果可查看，但无法持久保存到本机')).toBeInTheDocument();
    expect(screen.getByText('费用后胜率')).toBeInTheDocument();
  });
});
