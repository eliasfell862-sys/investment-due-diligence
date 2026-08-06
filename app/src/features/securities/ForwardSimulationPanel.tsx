import { useState } from 'react';
import { summarizeForwardSimulation } from './forward-simulation-summary';
import { calculateVirtualAvailability, type VirtualTradingLedger } from './virtual-trading-ledger';

export interface ForwardSimulationPanelProps {
  ledger: VirtualTradingLedger;
  prices: Record<string, number>;
  onViewStock(code: string): void;
  onViewAlert(alertId: string): void;
}

function money(value: number | null): string {
  if (value === null) return '--';
  return value < 0 ? `-¥${Math.abs(value).toFixed(2)}` : `¥${value.toFixed(2)}`;
}

function pct(value: number | null): string {
  return value === null ? '--' : `${value.toFixed(2)}%`;
}

function dateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '--';
}

function profitColor(value: number | null): string {
  if (value === null || value === 0) return '#b8c8c5';
  return value > 0 ? '#f56c6c' : '#67c23a';
}

function availabilityText(ledger: VirtualTradingLedger, code: string, strategyId: string): string {
  try {
    const result = calculateVirtualAvailability(ledger, code, strategyId, new Date());
    return `${result.totalShares.toLocaleString('zh-CN')} / ${result.availableShares.toLocaleString('zh-CN')}`;
  } catch {
    return '--';
  }
}

export function ForwardSimulationPanel({
  ledger,
  prices,
  onViewStock,
  onViewAlert,
}: ForwardSimulationPanelProps) {
  const [recordsTab, setRecordsTab] = useState<'transactions' | 'cycles'>('transactions');
  const summary = summarizeForwardSimulation(ledger, prices);
  const transactions = [...ledger.transactions].sort((a, b) => b.tradedAt.localeCompare(a.tradedAt));
  const cycles = [...ledger.cycles].sort((a, b) => b.openedAt.localeCompare(a.openedAt));

  const card = (label: string, value: string, color = '#f3eee4') => (
    <div style={{ padding: 10, background: '#102323', border: '1px solid #2a4242', borderRadius: 7 }}>
      <div style={{ color: '#76928e', fontSize: '0.66rem' }}>{label}</div>
      <div style={{ color, fontSize: '0.88rem', fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );

  return (
    <div style={{ padding: 14, color: '#d8e2df', minWidth: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(120px, 1fr))', gap: 8 }}>
        {card('已实现盈亏', money(summary.realizedProfit), profitColor(summary.realizedProfit))}
        {card('未实现盈亏', money(summary.unrealizedProfit), profitColor(summary.unrealizedProfit))}
        {card('总盈亏', money(summary.totalProfit), profitColor(summary.totalProfit))}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10, color: '#9fb6b2', fontSize: '0.72rem' }}>
        <span>胜率 {summary.winRate.toFixed(2)}%</span>
        <span>已结束周期 {summary.closedCycles}</span>
        <span>未平仓 {summary.openPositions.length}</span>
      </div>

      <section style={{ marginTop: 18 }}>
        <h4 style={{ margin: '0 0 9px', color: '#d4a574', fontSize: '0.8rem' }}>当前虚拟持仓</h4>
        {summary.openPositions.length === 0 ? (
          <div style={{ color: '#587575', fontSize: '0.72rem' }}>暂无未平仓虚拟持仓</div>
        ) : summary.openPositions.map(item => (
          <div key={item.position.id} style={{
            display: 'grid', gridTemplateColumns: 'minmax(140px, 1.4fr) repeat(4, minmax(85px, 1fr))',
            gap: 8, alignItems: 'center', padding: '9px 10px', marginBottom: 6,
            background: '#102323', borderRadius: 6, fontSize: '0.69rem',
          }}>
            <button
              type="button"
              aria-label={`查看虚拟持仓 ${item.position.name}`}
              onClick={() => onViewStock(item.position.code)}
              style={{ border: 0, background: 'transparent', padding: 0, textAlign: 'left', color: '#d4a574', cursor: 'pointer' }}
            >
              {item.position.name} ({item.position.code})
            </button>
            <span>总/可用 {availabilityText(ledger, item.position.code, item.position.strategyId)}</span>
            <span>成本 {money(item.position.averageCost)}</span>
            <span>现价 {item.currentPrice === null ? '--' : money(item.currentPrice)}</span>
            <span style={{ color: profitColor(item.unrealizedProfit) }}>
              {money(item.unrealizedProfit)} · {pct(item.unrealizedReturnPct)}
            </span>
          </div>
        ))}
      </section>

      <section style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
          <h4 style={{ margin: 0, color: '#d4a574', fontSize: '0.8rem' }}>记录</h4>
          <button type="button" onClick={() => setRecordsTab('transactions')} disabled={recordsTab === 'transactions'}>
            成交明细
          </button>
          <button type="button" onClick={() => setRecordsTab('cycles')} disabled={recordsTab === 'cycles'}>
            完整周期
          </button>
        </div>

        {recordsTab === 'transactions' ? (
          transactions.length === 0 ? <div style={{ color: '#587575' }}>暂无虚拟成交</div> : transactions.map(transaction => (
            <div key={transaction.id} style={{
              display: 'grid', gridTemplateColumns: '1.1fr 0.7fr 0.8fr 1fr auto', gap: 8,
              padding: '8px 10px', borderBottom: '1px solid #243838', fontSize: '0.68rem',
            }}>
              <span>{transaction.name} ({transaction.code})</span>
              <span>{transaction.intent} · {transaction.shares}股</span>
              <span>{money(transaction.price)}</span>
              <span>{dateTime(transaction.tradedAt)}</span>
              <button
                type="button"
                aria-label={`查看消息 ${transaction.sourceSignalId}`}
                onClick={() => onViewAlert(transaction.sourceSignalId)}
              >
                {transaction.sourceSignalId}
              </button>
            </div>
          ))
        ) : (
          cycles.length === 0 ? <div style={{ color: '#587575' }}>暂无完整周期</div> : cycles.map(cycle => (
            <div key={cycle.id} style={{
              display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 8,
              padding: '8px 10px', borderBottom: '1px solid #243838', fontSize: '0.68rem',
            }}>
              <span>{cycle.name} ({cycle.code})</span>
              <span>{cycle.status === 'closed' ? `已结束 · 收益率 ${pct(cycle.returnPct)}` : '进行中'}</span>
              <span style={{ color: profitColor(cycle.realizedProfit) }}>
                已实现 {money(cycle.realizedProfit)}
              </span>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
