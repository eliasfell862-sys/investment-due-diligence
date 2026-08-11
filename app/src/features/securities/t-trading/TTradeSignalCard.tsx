import type { BacktestSignalAlertV3 } from '../backtest-signal-inbox-store';

interface Props {
  alert: BacktestSignalAlertV3;
  onExecute(alert: BacktestSignalAlertV3): void;
  onKeepAsReduction?(alert: BacktestSignalAlertV3): void;
  onMarkRead(alertId: string): void;
  onViewStock(code: string): void;
}

const money = (value: number) => value.toFixed(2);
const range = (value: [number, number] | null) => value ? `¥${money(value[0])}–¥${money(value[1])}` : '—';

function title(alert: BacktestSignalAlertV3): string {
  if (alert.messageKind === 'actual_t_buyback') return '做 T 回补信号';
  if (alert.messageKind === 'actual_t_expiry_risk') return '做 T 到期风险';
  if (alert.messageKind === 'actual_t_risk_review') return '回补暂停：风险复核';
  return '做 T 卖出信号';
}

export function TTradeSignalCard({ alert, onExecute, onKeepAsReduction, onMarkRead, onViewStock }: Props) {
  const detail = alert.tTrade;
  if (!detail) return null;
  const executable = alert.status === 'pending'
    && (detail.kind === 'actual_t_sell' || detail.kind === 'actual_t_buyback');
  return <article data-testid={`t-trade-alert-${alert.id}`} style={{ padding: 12, borderTop: '1px solid #365252', background: '#102323' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <div>
        <strong style={{ color: detail.kind === 'actual_t_risk_review' ? '#f0b870' : '#d4a574' }}>{title(alert)}</strong>
        <div>{alert.name}（{alert.code}） · 信号价 ¥{money(alert.price)} · {alert.suggestedShares} 股</div>
        {detail.kind === 'actual_t_sell' && <>
          <div>卖出区间 {range(detail.sellRange)} · 回补区间 {range(detail.buybackRange)}</div>
          <div>预计双边费用 ¥{money(detail.expectedRoundTripFees)} · 预计净收益 ¥{money(detail.expectedNetProfit)}</div>
        </>}
        {detail.kind === 'actual_t_buyback' && <div>回补区间 {range(detail.targetRange)} · 原卖出价 ¥{money(detail.actualSellPrice)}</div>}
        <div>ATR ¥{money(detail.atr20)} · ATRP {(detail.atrp20 * 100).toFixed(2)}% · 压力 ¥{money(detail.resistance)} · 量比 {detail.volumeRatio20.toFixed(2)} · 资金 {detail.flowBias || '未知'}</div>
        {detail.expiresAt && <div>有效期至 {new Date(detail.expiresAt).toLocaleString('zh-CN')}</div>}
        <div>{[...alert.reasons, ...detail.reasons].join('；')}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flexWrap: 'wrap' }}>
        {!alert.readAt && <button type="button" onClick={() => onMarkRead(alert.id)}>标记已读</button>}
        <button type="button" onClick={() => onViewStock(alert.code)}>查看个股</button>
        {detail.kind === 'actual_t_expiry_risk' && alert.status === 'pending' && onKeepAsReduction && <button type="button" aria-label={`保留为减仓 ${alert.name}`} onClick={() => onKeepAsReduction(alert)}>保留为减仓</button>}
        {executable && <button type="button" aria-label={`执行做 T ${detail.kind === 'actual_t_sell' ? '卖出' : '回补'} ${alert.name}`} onClick={() => onExecute(alert)}>
          执行{detail.kind === 'actual_t_sell' ? '卖出' : '回补'}
        </button>}
      </div>
    </div>
  </article>;
}