import type { ReactElement } from 'react';
import type { ShortTermAdviceAction } from '../../../engines/market-analysis/short-term-trading-advice';
import { selectCalibrationMetricsForAction } from './aggregate';
import type { CalibrationMetrics, CalibrationTrust } from './types';
import type { CalibrationHookState } from './useWatchlistShortTermCalibration';

const trustLabels: Record<CalibrationTrust, string> = {
  insufficient: '样本不足',
  preliminary: '初步证据',
  established: '已建立可信度',
  blocked: '已阻断',
};

const percent = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(2)}%`;
const decimal = (value: number | null) => value === null ? '—' : value.toFixed(2);

function Metric({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div style={{ padding: '9px 11px', borderRadius: 8, background: '#1a2529', border: '1px solid #344247' }}>
      <div style={{ color: '#9da9ac', fontSize: 11, marginBottom: 4 }}>{label}</div>
      <strong style={{ color: '#edf2f3', fontSize: 15 }}>{value}</strong>
    </div>
  );
}

function Metrics({ metrics }: { metrics: CalibrationMetrics }): ReactElement {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 8 }}>
      <Metric label="信号成交率" value={percent(metrics.fillRate)} />
      <Metric label="费用后胜率" value={percent(metrics.winRate)} />
      <Metric label="平均净收益" value={percent(metrics.averageNetReturnPct)} />
      <Metric label="最大回撤" value={percent(metrics.maxDrawdownPct)} />
      <Metric label="盈亏比" value={decimal(metrics.profitFactor)} />
      <Metric label="成交笔数" value={`${metrics.completedTrades}笔`} />
    </div>
  );
}

export function WatchlistShortTermCalibrationCard({
  action,
  state,
}: {
  action: ShortTermAdviceAction;
  state: CalibrationHookState;
}): ReactElement {
  const selection = state.result
    ? selectCalibrationMetricsForAction(state.result, action)
    : null;

  return (
    <section style={{ marginTop: 16, padding: 14, borderRadius: 10, background: '#10191d', border: '1px solid #344247' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          <strong style={{ color: '#8fd3c8' }}>短线历史校准</strong>
          {state.result && (
            <span style={{ marginLeft: 10, color: '#c5ccce', fontSize: 12 }}>
              {trustLabels[state.result.trust]}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void state.recalibrate()}
          disabled={state.status === 'running'}
          style={{
            padding: '6px 12px', borderRadius: 7, border: '1px solid #65b9ac',
            background: state.status === 'running' ? '#273438' : '#1d4c47',
            color: state.status === 'running' ? '#8d989b' : '#d9fffa',
            cursor: state.status === 'running' ? 'default' : 'pointer',
          }}
        >
          重新校准
        </button>
      </div>

      {state.status === 'loading' && !state.result && <p style={{ color: '#aeb7b9' }}>正在读取本地校准结果…</p>}
      {state.status === 'running' && state.progress && (
        <p style={{ margin: '0 0 10px', color: '#f6c87a', fontSize: 12 }}>
          <span>已处理 {state.progress.completed} / {state.progress.total}</span>
          {state.progress.currentCode ? <span> · {state.progress.currentCode}</span> : null}
        </p>
      )}
      {state.stale && <p style={{ margin: '0 0 8px', color: '#f6c87a', fontSize: 12 }}>结果已过期</p>}
      {state.error && <p style={{ margin: '0 0 8px', color: '#fca5a5', fontSize: 12 }}>{state.error}</p>}
      {state.result?.persistenceWarning && (
        <p style={{ margin: '0 0 8px', color: '#f6c87a', fontSize: 12 }}>{state.result.persistenceWarning}</p>
      )}

      {selection?.scope === 'not_applicable' && (
        <p style={{ margin: 0, color: '#b9c2c4' }}>当前不是买入信号，不适用买入胜率</p>
      )}

      {selection && selection.scope !== 'not_applicable' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ color: '#f6c87a', fontSize: 12, fontWeight: 700 }}>
              {selection.scope === 'action_group' ? '当前信号分组' : '总体样本降级'}
            </span>
            <span style={{ color: '#9da9ac', fontSize: 12 }}>
              {selection.metrics.completedTrades}笔成交 · 数据截至 {state.result!.dataAsOf}
            </span>
          </div>
          <Metrics metrics={selection.metrics} />
          <p style={{ margin: '10px 0 0', color: '#9da9ac', fontSize: 12 }}>
            覆盖 {state.result!.validStockCount}只 · 直接口径 {state.result!.directStockCount}只 · 代理口径 {state.result!.proxyStockCount}只
          </p>

          {state.result!.warnings.map(warning => (
            <p key={warning} style={{ margin: '6px 0 0', color: '#fca5a5', fontSize: 12 }}>{warning}</p>
          ))}
        </>
      )}

      {!state.result && state.status !== 'loading' && (
        <p style={{ margin: 0, color: '#9da9ac' }}>暂无可用校准结果</p>
      )}
    </section>
  );
}