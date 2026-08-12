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
  foregroundStatus?: 'loading' | 'ready' | 'waiting' | 'error';
  foregroundError?: string;
}

const prices = (range: [number, number] | null | undefined) => range
  ? `¥${range[0].toFixed(2)}–${range[1].toFixed(2)}` : '—';

export function TTradePositionSummary({
  alert, cycle, sampleInsufficient = false, foregroundStatus, foregroundError,
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
  if (foregroundStatus === 'loading') return <span style={{ color: '#829995' }}>正在计算做 T 计划</span>;
  if (foregroundStatus === 'waiting') return <span style={{ color: '#829995' }}>已获取行情与 K 线，暂未触发做 T 条件</span>;
  if (foregroundStatus === 'error') return <span style={{ color: '#f0b870' }}>做 T 计算失败：{foregroundError || '未知错误'}</span>;
  return <span style={{ color: '#829995' }}>行情或 K 线过期，未生成做 T 信号</span>;
}
