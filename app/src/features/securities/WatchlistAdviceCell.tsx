import type { ReactElement } from 'react';
import type { MediumTermBuyAdvice } from '../../engines/market-analysis/medium-term-buy-advice';
import type { WatchlistAdviceTaskState } from './watchlist-buy-advice-service';

export interface WatchlistAdviceCellProps {
  stockName: string;
  state: WatchlistAdviceTaskState;
  expanded: boolean;
  onToggle: () => void;
  onRetry: () => void;
}

export interface WatchlistAdviceDetailRowProps {
  advice: MediumTermBuyAdvice;
  colSpan: number;
}

const actionColors = {
  accumulate: { foreground: '#f6c87a', background: '#5a431f' },
  cautious_buy: { foreground: '#e7bc78', background: '#48391f' },
  watch: { foreground: '#8fd3c8', background: '#173c3a' },
  avoid_buying: { foreground: '#f0b870', background: '#49351e' },
  risk_avoidance: { foreground: '#fca5a5', background: '#4b2328' },
  insufficient_data: { foreground: '#c0c0c0', background: '#303638' },
} as const;

const quietCellStyle = { padding: '12px 14px', color: '#a9b0b2', whiteSpace: 'nowrap' } as const;

export function WatchlistAdviceCell({ stockName, state, expanded, onToggle, onRetry }: WatchlistAdviceCellProps): ReactElement {
  if (state.status === 'waiting' || state.status === 'loading') {
    return <td style={quietCellStyle} onClick={event => event.stopPropagation()}>{state.status === 'waiting' ? '等待分析' : '分析中'}</td>;
  }

  if (state.status === 'error') {
    return (
      <td style={quietCellStyle} onClick={event => event.stopPropagation()}>
        <div style={{ color: '#fca5a5', marginBottom: 5 }}>{state.error}</div>
        <button type="button" aria-label={`重试${stockName}建议`} onClick={onRetry} style={{ cursor: 'pointer' }}>重试</button>
      </td>
    );
  }

  const colors = actionColors[state.advice.action];
  return (
    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }} onClick={event => event.stopPropagation()}>
      <button
        type="button"
        aria-label={`查看${stockName}中线建议`}
        aria-expanded={expanded}
        onClick={onToggle}
        style={{
          display: 'grid', gap: 3, minWidth: 106, padding: '7px 10px', border: `1px solid ${colors.foreground}55`,
          borderRadius: 8, color: colors.foreground, background: colors.background, cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ fontWeight: 700 }}>{state.advice.label}</span>
        <span style={{ display: 'flex', gap: 5, fontSize: 12 }}>
          <span>{state.advice.score}分</span>
          <span>置信度：{state.advice.confidenceLabel}</span>
        </span>
      </button>
    </td>
  );
}

function completeness(advice: MediumTermBuyAdvice): string {
  const status = (complete: boolean) => complete ? '完整' : '缺失';
  return `行情：${status(advice.dataCompleteness.quote)} · K线：${status(advice.dataCompleteness.kline)} · 基本面：${status(advice.dataCompleteness.fundamental)}`;
}

export function WatchlistAdviceDetailRow({ advice, colSpan }: WatchlistAdviceDetailRowProps): ReactElement {
  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: '14px 18px', background: '#171d1f', borderTop: '1px solid #30383a', color: '#d7dcdd' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
          <section>
            <strong style={{ color: '#f6c87a' }}>主要依据</strong>
            {advice.reasons.length > 0 ? <ol>{advice.reasons.map(reason => <li key={reason}>{reason}</li>)}</ol> : <p>暂无明确积极依据</p>}
          </section>
          <section>
            <strong style={{ color: '#fca5a5' }}>主要风险</strong>
            {advice.risks.length > 0 ? <ol>{advice.risks.map(risk => <li key={risk}>{risk}</li>)}</ol> : <p>未识别到突出风险信号</p>}
          </section>
        </div>
        <div style={{ marginTop: 10, color: '#9da6a8', fontSize: 12 }}>
          {completeness(advice)} · 计算时间：{new Date(advice.calculatedAt).toLocaleString('zh-CN')} · 周期：1–3个月
        </div>
      </td>
    </tr>
  );
}
