import type { ActualPositionTPlan } from './actual-position-t-plan';

interface PositionAlert {
  kind: 'actual_t_sell' | 'actual_t_buyback' | 'actual_t_expiry_risk' | 'actual_t_risk_review';
  shares: number;
  sellRange?: [number, number] | null;
  buybackRange?: [number, number] | null;
  targetRange?: [number, number] | null;
}

interface PositionCycle {
  status: string;
  soldShares: number;
  remainingBuybackShares: number;
  realizedTProfit: number;
}

interface Props {
  alert: PositionAlert | null;
  cycle: PositionCycle | null;
  sampleInsufficient?: boolean;
  foreground?: ActualPositionTPlan;
}

const prices = (range: [number, number] | null | undefined) => range
  ? '¥' + range[0].toFixed(2) + '–' + range[1].toFixed(2) : '—';

function reasonText(reason: string): string {
  const labels: Record<string, string> = {
    sell_range_not_reached: '尚未达到卖出区间',
    technical_confirmation_missing: '技术确认条件不足',
    cost_reduction_requires_two_confirmations: '降成本 T 需至少两项确认',
    below_board_lot: '可用股数不足 100 股',
    round_trip_not_profitable: '扣除手续费后预期收益不足',
    invalid_input: '行情或持仓参数不完整',
  };
  return labels[reason] ?? reason;
}

export function TTradePositionSummary({
  alert,
  cycle,
  sampleInsufficient = false,
  foreground,
}: Props) {
  if (cycle?.status === 'buyback_paused_risk_review') {
    return <span style={{ color: '#f0b870' }}>回补已暂停，等待风险复核</span>;
  }
  if (cycle && ['sell_executed', 'buyback_monitoring', 'buyback_signal_pending', 'partially_bought_back'].includes(cycle.status)) {
    return <div><div>已卖 {cycle.soldShares} 股 · 待回补 {cycle.remainingBuybackShares} 股</div><div style={{ color: '#70b8b0' }}>已实现 T 收益 ¥{cycle.realizedTProfit.toFixed(2)}</div></div>;
  }
  if (alert?.kind === 'actual_t_sell') {
    return <div><div>卖出 {alert.shares} 股 · {prices(alert.sellRange)}</div><div style={{ color: '#70b8b0' }}>计划回补 {prices(alert.buybackRange)}</div></div>;
  }
  if (alert?.kind === 'actual_t_buyback') {
    return <div>回补 {alert.shares} 股 · {prices(alert.targetRange)}</div>;
  }
  if (alert?.kind === 'actual_t_risk_review') {
    return <span style={{ color: '#f0b870' }}>回补已暂停，等待风险复核</span>;
  }
  if (alert?.kind === 'actual_t_expiry_risk') {
    return <span style={{ color: '#f0b870' }}>临近收盘，待决定回补或保留减仓</span>;
  }
  if (sampleInsufficient) return <span style={{ color: '#f0b870' }}>样本不足，使用保守参数</span>;

  if (foreground?.status === 'sell') {
    const recommendation = foreground.recommendation;
    return (
      <div>
        <div>卖出 {recommendation.shares} 股 · {prices(recommendation.sellRange)}</div>
        <div style={{ color: '#70b8b0' }}>
          计划回补 {prices(recommendation.buybackRange)} · 预期净收益 ¥{recommendation.expectedNetProfit.toFixed(2)}
        </div>
      </div>
    );
  }
  if (foreground?.status === 'loading') {
    return <span style={{ color: '#829995' }}>正在计算做 T 条件…</span>;
  }
  if (foreground?.status === 'not_triggered') {
    return (
      <div>
        <div style={{ color: '#829995' }}>当前未触发做 T 条件</div>
        {foreground.reasons[0] && (
          <div style={{ color: '#647b78', fontSize: '0.72rem', marginTop: 2 }}>
            {reasonText(foreground.reasons[0])}
          </div>
        )}
      </div>
    );
  }
  if (foreground?.status === 'sample_insufficient') {
    return <span style={{ color: '#f0b870' }}>K 线样本不足（{foreground.sampleDays}/20）</span>;
  }
  if (foreground?.status === 'stale') {
    return <span style={{ color: '#f0b870' }}>实时行情已过期，请刷新后重试</span>;
  }
  if (foreground?.status === 'no_quote') {
    return <span style={{ color: '#f0b870' }}>暂无实时行情，无法计算做 T 条件</span>;
  }
  if (foreground?.status === 'error') {
    return <span style={{ color: '#f87171' }}>做 T 计算失败：{foreground.message}</span>;
  }
  return <span style={{ color: '#829995' }}>正在等待做 T 计算</span>;
}