import type { ReactElement } from 'react';
import type { ShortTermTradingAdvice } from '../../engines/market-analysis/short-term-trading-advice';
import type { WatchlistShortTermTaskState } from './watchlist-short-term-advice-service';
import { WatchlistShortTermCalibrationCard } from './watchlist-short-term-calibration/WatchlistShortTermCalibrationCard';
import type { CalibrationHookState } from './watchlist-short-term-calibration/useWatchlistShortTermCalibration';

export interface WatchlistShortTermAdviceCellProps {
  stockName: string;
  state: WatchlistShortTermTaskState;
  expanded: boolean;
  onToggle: () => void;
  onRetry: () => void;
}

export interface WatchlistShortTermAdviceDetailRowProps {
  advice: ShortTermTradingAdvice;
  colSpan: number;
  calibration: CalibrationHookState;
}

const actionColors = {
  strong_buy: { foreground: '#ff8f70', background: '#4b2420' },
  buy_on_dip: { foreground: '#f6c87a', background: '#4d3b1f' },
  hold_watch: { foreground: '#8fd3c8', background: '#173c3a' },
  avoid: { foreground: '#f0b870', background: '#49351e' },
  reduce_sell: { foreground: '#fca5a5', background: '#4b2328' },
  insufficient_data: { foreground: '#c0c0c0', background: '#303638' },
} as const;

const displayAction = {
  strong_buy: '买入',
  buy_on_dip: '买入',
  hold_watch: '观望',
  avoid: '回避',
  reduce_sell: '回避',
  insufficient_data: '观望',
} as const;

const quietCellStyle = { padding: '12px 14px', color: '#a9b0b2', whiteSpace: 'nowrap' } as const;
const price = (value: number | null) => value === null ? '—' : value.toFixed(2);

export function WatchlistShortTermAdviceCell({
  stockName,
  state,
  expanded,
  onToggle,
  onRetry,
}: WatchlistShortTermAdviceCellProps): ReactElement {
  if (state.status === 'waiting' || state.status === 'loading') {
    return (
      <td style={quietCellStyle} onClick={event => event.stopPropagation()}>
        {state.status === 'waiting' ? '等待分析' : '分析中'}
      </td>
    );
  }

  if (state.status === 'error') {
    return (
      <td style={quietCellStyle} onClick={event => event.stopPropagation()}>
        <div style={{ color: '#fca5a5', marginBottom: 5 }}>{state.error}</div>
        <button type="button" aria-label={`重试${stockName}短线建议`} onClick={onRetry} style={{ cursor: 'pointer' }}>
          重试
        </button>
      </td>
    );
  }

  const advice = state.advice;
  const colors = actionColors[advice.action];
  return (
    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }} onClick={event => event.stopPropagation()}>
      <button
        type="button"
        aria-label={`查看${stockName}短线建议`}
        aria-expanded={expanded}
        onClick={onToggle}
        style={{
          display: 'grid', gap: 3, minWidth: 144, padding: '7px 10px', border: `1px solid ${colors.foreground}55`,
          borderRadius: 8, color: colors.foreground, background: colors.background, cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: 700 }}>
          <span>{displayAction[advice.action]}</span>
          {advice.cacheStatus === 'cached' && <span style={{ color: '#a9b0b2', fontSize: 10 }}>缓存</span>}
        </span>
        <span style={{ color: '#d7dcdd', fontSize: 11 }}>{advice.score}分 · {advice.confidenceLabel}</span>
        {advice.entryRange && (
          <>
            <span style={{ color: '#f6c87a', fontSize: 11 }}>买入 {price(advice.entryRange.low)}–{price(advice.entryRange.high)}</span>
            <span style={{ color: '#d7dcdd', fontSize: 10 }}>止损 {price(advice.stopLoss)} · 止盈 {price(advice.takeProfit1)}</span>
          </>
        )}
      </button>
    </td>
  );
}

function completeness(advice: ShortTermTradingAdvice): string {
  const status = (complete: boolean) => complete ? '完整' : '缺失';
  return `行情：${status(advice.dataCompleteness.quote)} · K线：${status(advice.dataCompleteness.kline)} · 指标：${status(advice.dataCompleteness.indicators)} · 策略：${status(advice.dataCompleteness.strategies)}`;
}

export function WatchlistShortTermAdviceDetailRow({
  advice,
  colSpan,
  calibration,
}: WatchlistShortTermAdviceDetailRowProps): ReactElement {
  const evidence = advice.evidence?.length ? advice.evidence : advice.reasons;
  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: '14px 18px', background: '#141c20', borderTop: '1px solid #30383a', color: '#d7dcdd' }}>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12, color: '#f6c87a' }}>
          <strong>第二止盈：{price(advice.takeProfit2)}</strong>
          <strong>风险收益比：{advice.riskRewardRatio?.toFixed(2) ?? '—'}</strong>
          <strong>最长持有：{advice.maxHoldingTradingDays === null ? '—' : `${advice.maxHoldingTradingDays}个交易日`}</strong>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
          <section>
            <strong style={{ color: '#8fd3c8' }}>信息依据</strong>
            {evidence.length > 0 ? <ol>{evidence.map(item => <li key={item}>{item}</li>)}</ol> : <p>行情或技术指标不足，当前结论为观望</p>}
          </section>
          <section>
            <strong style={{ color: '#fca5a5' }}>短线风险</strong>
            {advice.risks.length > 0 ? <ol>{advice.risks.map(risk => <li key={risk}>{risk}</li>)}</ol> : <p>未识别到突出风险信号</p>}
          </section>
        </div>
        <div style={{ marginTop: 10, color: '#9da6a8', fontSize: 12 }}>
          {completeness(advice)} · 数据时间：{advice.dataAsOf} · 计算时间：{new Date(advice.calculatedAt).toLocaleString('zh-CN')}
          {advice.cacheStatus === 'cached' ? ' · 基于缓存' : ''} · 周期：3–10个交易日
        </div>
        <WatchlistShortTermCalibrationCard action={advice.action} state={calibration} />

      </td>
    </tr>
  );
}
