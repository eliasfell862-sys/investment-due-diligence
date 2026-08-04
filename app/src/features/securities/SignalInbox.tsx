import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  buyStockPosition,
  findStockPosition,
  loadStockLedger,
  sellStockPosition,
  type StockPositionLedger,
} from './stock-position-ledger';
import { StockTradeConfirmDialog, type StockTradeConfirmation } from './StockTradeConfirmDialog';
import { useRealtimeBacktestMonitor } from './useRealtimeBacktestMonitor';
import type { BacktestSignalAlert } from './backtest-signal-inbox-store';

function loadLedgerSafely(): StockPositionLedger {
  try {
    return loadStockLedger();
  } catch {
    return { version: 1, groups: [], positions: [], transactions: [] };
  }
}

function marketStatusLabel(status: string): string {
  if (status === 'trading') return '实时监听中';
  if (status === 'lunch_break') return '午间休市';
  if (status === 'weekend') return '周末休市';
  return '已收盘';
}

function executedLabel(alert: BacktestSignalAlert): string {
  if (alert.status === 'bought') return '已买入';
  if (alert.status === 'sold') return '已卖出';
  return '';
}

export function SignalInbox() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const monitor = useRealtimeBacktestMonitor();
  const [open, setOpen] = useState(false);
  const [ledger, setLedger] = useState<StockPositionLedger>(loadLedgerSafely);
  const [tradeAlert, setTradeAlert] = useState<BacktestSignalAlert | null>(null);
  const [actionError, setActionError] = useState('');

  const openTrade = (alert: BacktestSignalAlert) => {
    setLedger(loadLedgerSafely());
    setActionError('');
    monitor.markRead(alert.id);
    setTradeAlert(alert);
  };

  const confirmTrade = (input: StockTradeConfirmation) => {
    if (!tradeAlert) return;
    setActionError('');
    try {
      if (tradeAlert.action === 'buy') {
        const groupId = input.groupId === '__new__'
          ? `group-${Date.now()}`
          : input.groupId;
        const groupName = input.groupId === '__new__'
          ? input.newGroupName
          : ledger.groups.find(group => group.id === groupId)?.name ?? '默认持仓';
        const result = buyStockPosition({
          code: tradeAlert.code,
          name: tradeAlert.name,
          shares: input.shares,
          price: input.price,
          groupId,
          groupName,
          sourceAlertId: tradeAlert.id,
          tradedAt: new Date().toISOString(),
        });
        setLedger(result.ledger);
        monitor.markExecuted(tradeAlert.id, 'bought', true);
      } else {
        const result = sellStockPosition({
          code: tradeAlert.code,
          shares: input.shares,
          price: input.price,
          sourceAlertId: tradeAlert.id,
          tradedAt: new Date().toISOString(),
        });
        setLedger(result.ledger);
        monitor.markExecuted(tradeAlert.id, 'sold', Boolean(result.position));
      }
      monitor.reloadLedger();
      setTradeAlert(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const viewStock = (code: string) => {
    const target = projectId
      ? `/projects/${projectId}/securities/stock/${code}`
      : `/securities/stock/${code}`;
    navigate(target);
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        title="实时回测买卖信号"
        onClick={() => setOpen(current => !current)}
        style={{
          position: 'relative', padding: '6px 12px',
          background: open ? '#1a3a3a' : '#0d1a1a',
          border: `1px solid ${monitor.unreadCount > 0 ? '#d4a574' : '#3a5a5a'}`,
          borderRadius: 6, cursor: 'pointer', fontSize: '1.05rem', color: '#d4a574',
        }}
      >
        📬
        {monitor.unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: -7, right: -7, minWidth: 20, height: 20,
            padding: '0 4px', boxSizing: 'border-box', borderRadius: 10,
            background: '#f56c6c', color: '#fff', fontSize: '0.65rem', fontWeight: 'bold',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {monitor.unreadCount > 99 ? '99+' : monitor.unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, width: 430, maxWidth: '92vw',
          maxHeight: 560, overflowY: 'auto', marginTop: 6, zIndex: 100,
          background: '#172727', border: '1px solid #3a5a5a', borderRadius: 8,
          boxShadow: '0 10px 36px rgba(0,0,0,0.5)',
        }}>
          <div style={{
            position: 'sticky', top: 0, zIndex: 2, padding: '11px 14px',
            background: '#172727', borderBottom: '1px solid #2a4242',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div>
                <div style={{ color: '#d4a574', fontWeight: 'bold', fontSize: '0.86rem' }}>实时回测买卖信号</div>
                <div style={{ color: '#70b8b0', fontSize: '0.68rem', marginTop: 3 }}>
                  {marketStatusLabel(monitor.marketStatus)}
                  {monitor.lastUpdatedAt ? ` · ${new Date(monitor.lastUpdatedAt).toLocaleTimeString('zh-CN')}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 7 }}>
                <button
                  type="button"
                  aria-label="立即刷新信号"
                  onClick={() => void monitor.refreshNow()}
                  disabled={monitor.checking}
                  style={{ border: 0, background: 'transparent', color: '#70b8b0', cursor: 'pointer' }}
                >
                  {monitor.checking ? '检查中…' : '立即刷新'}
                </button>
                <button
                  type="button"
                  onClick={monitor.clearAlerts}
                  style={{ border: 0, background: 'transparent', color: '#f87171', cursor: 'pointer' }}
                >清空</button>
              </div>
            </div>
            {monitor.partialFailureCount > 0 && (
              <div style={{ color: '#f0b870', fontSize: '0.68rem', marginTop: 6 }}>
                {monitor.partialFailureCount}只股票监听失败
              </div>
            )}
            {(monitor.error || actionError) && (
              <div role="alert" style={{ color: '#f87171', fontSize: '0.7rem', marginTop: 6 }}>
                {actionError || monitor.error}
              </div>
            )}
          </div>

          {monitor.alerts.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#70b8b0', fontSize: '0.82rem' }}>
              暂无新的回测买卖信号
              <br />
              <span style={{ color: '#587575', fontSize: '0.7rem' }}>
                交易时段随 3 秒实时行情监听全部自选股
              </span>
            </div>
          ) : monitor.alerts.map(alert => {
            const position = findStockPosition(ledger, alert.code);
            const isBuy = alert.action === 'buy';
            const executed = alert.status !== 'pending';
            const floatingProfit = position
              ? (alert.price - position.averageCost) * position.shares
              : 0;
            return (
              <article
                key={alert.id}
                style={{
                  padding: '12px 14px', borderBottom: '1px solid #243838',
                  borderLeft: `3px solid ${isBuy ? '#f56c6c' : '#67c23a'}`,
                  background: alert.readAt ? 'transparent' : '#102323',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: isBuy ? '#ff7b7b' : '#7dcc57', fontWeight: 'bold', fontSize: '0.8rem' }}>
                    {isBuy ? '📈 买入信号' : '📉 卖出信号'}
                  </span>
                  <span style={{ color: '#587575', fontSize: '0.64rem' }}>
                    {new Date(alert.signalAt).toLocaleTimeString('zh-CN')}
                  </span>
                </div>
                <div style={{ color: '#d4a574', fontWeight: 'bold', fontSize: '0.84rem', marginTop: 7 }}>
                  {alert.name} ({alert.code})
                </div>
                <div style={{ color: '#d8e2df', fontSize: '0.72rem', marginTop: 4 }}>
                  实时价 ¥{alert.price.toFixed(2)} · {alert.reasons.join(' · ') || '回测策略状态变化'}
                </div>
                {!isBuy && position && (
                  <div style={{ color: '#9fb6b2', fontSize: '0.7rem', marginTop: 5 }}>
                    持仓 {position.shares} 股 · 成本 ¥{position.averageCost.toFixed(2)} · 浮盈亏
                    <span style={{ color: floatingProfit >= 0 ? '#f56c6c' : '#67c23a', marginLeft: 4 }}>
                      {floatingProfit >= 0 ? '+' : ''}{floatingProfit.toFixed(2)}
                    </span>
                  </div>
                )}
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4,
                  marginTop: 8, padding: '7px 8px', background: '#0d1a1a', borderRadius: 5,
                  color: '#76928e', fontSize: '0.65rem',
                }}>
                  <span>回测 {alert.metrics.totalTrades}笔</span>
                  <span>胜率 {alert.metrics.winRate}%</span>
                  <span>夏普 {alert.metrics.sharpeRatio}</span>
                  <span>年化 {alert.metrics.annualReturn}%</span>
                  <span>回撤 -{alert.metrics.maxDrawdown}%</span>
                  <span>盈亏比 {alert.metrics.profitFactor}</span>
                </div>
                <div style={{ display: 'flex', gap: 7, marginTop: 9, flexWrap: 'wrap' }}>
                  {!alert.readAt && (
                    <button type="button" aria-label={`标记已读 ${alert.name}`} onClick={() => monitor.markRead(alert.id)}>
                      标记已读
                    </button>
                  )}
                  <button type="button" aria-label={`查看个股 ${alert.name}`} onClick={() => viewStock(alert.code)}>
                    查看个股
                  </button>
                  <button
                    type="button"
                    aria-label={`${isBuy ? '确认买入' : '确认卖出'} ${alert.name}`}
                    disabled={executed || (!isBuy && !position)}
                    onClick={() => openTrade(alert)}
                    style={{
                      color: '#fff', border: 0, borderRadius: 4, padding: '5px 10px',
                      cursor: executed ? 'default' : 'pointer',
                      background: executed ? '#425454' : isBuy ? '#f56c6c' : '#67c23a',
                    }}
                  >
                    {executed ? executedLabel(alert) : isBuy ? '确认买入' : '确认卖出'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {tradeAlert && (
        <StockTradeConfirmDialog
          alert={tradeAlert}
          position={findStockPosition(ledger, tradeAlert.code)}
          groups={ledger.groups}
          onConfirm={confirmTrade}
          onCancel={() => { setTradeAlert(null); setActionError(''); }}
        />
      )}
    </div>
  );
}
