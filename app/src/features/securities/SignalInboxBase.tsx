import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  buyStockPosition,
  findStockPosition,
  loadStockLedger,
  sellStockPosition,
  type StockPosition,
  type StockPositionGroup,
  type StockPositionLedger,
} from './stock-position-ledger';
import { StockTradeConfirmDialog, type StockTradeConfirmation } from './StockTradeConfirmDialog';
import { useRealtimeBacktestMonitorContext } from './RealtimeBacktestMonitorProvider';
import type { BacktestSignalAlertV3 } from './backtest-signal-inbox-store';
import { calculateStockPositionAvailability } from './stock-position-availability';
import { ForwardSimulationPanel } from './ForwardSimulationPanel';

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

function intentLabel(intent: BacktestSignalAlertV3['intent']): string {
  if (intent === 'add') return '补仓';
  if (intent === 'reduce') return '部分卖出';
  if (intent === 'exit') return '全部卖出';
  return '首次买入';
}

function executedLabel(alert: BacktestSignalAlertV3): string {
  if (alert.status === 'bought') return '已买入';
  if (alert.status === 'sold') return '已卖出';
  return '';
}

function trackingLabel(alert: BacktestSignalAlertV3): string {
  if (alert.messageKind === 'legacy') return '历史信号，未纳入虚拟交易';
  if (alert.messageKind === 'virtual_pending') return alert.virtualTrackingStatus === 'cancelled_revalidation'
    ? 'T+1 复核后卖出信号已取消'
    : 'T+1 待卖，下一交易日复核';
  if (alert.messageKind === 'virtual_blocked') return '卖出受T+1限制';
  if (alert.messageKind === 'actual_position_risk') return '实际持仓风控提醒';
  if (alert.intent === 'add') return '虚拟已补仓';
  if (alert.intent === 'reduce') return '虚拟已部分卖出';
  if (alert.intent === 'exit') return '虚拟已全部卖出';
  return '虚拟已买入';
}

function trackingColor(alert: BacktestSignalAlertV3): string {
  if (alert.messageKind === 'legacy') return '#8ea5a1';
  if (alert.messageKind === 'virtual_pending') return alert.virtualTrackingStatus === 'cancelled_revalidation' ? '#8ea5a1' : '#f0b870';
  if (alert.messageKind === 'virtual_blocked') return '#f0b870';
  if (alert.messageKind === 'actual_position_risk') return '#72a7d8';
  return '#70b8b0';
}

function groupForPosition(
  ledger: StockPositionLedger,
  position: StockPosition | null,
): StockPositionGroup | undefined {
  if (!position) return undefined;
  return ledger.groups.find(group => group.id === position.groupId)
    ?? { id: position.groupId, name: '原持仓组' };
}

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleTimeString('zh-CN') : '尚未扫描';
}

function maximumSellableShares(ledger: StockPositionLedger, code: string, asOf: Date | string): number {
  try {
    const availability = calculateStockPositionAvailability(ledger, code, asOf);
    return Math.floor(availability.availableShares / 100) * 100;
  } catch {
    return 0;
  }
}
export function SignalInbox() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const monitor = useRealtimeBacktestMonitorContext();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'messages' | 'forward'>('messages');
  const [ledger, setLedger] = useState<StockPositionLedger>(loadLedgerSafely);
  const [tradeAlert, setTradeAlert] = useState<BacktestSignalAlertV3 | null>(null);
  const [tradePosition, setTradePosition] = useState<StockPosition | null>(null);
  const [maxSellShares, setMaxSellShares] = useState<number | null>(null);
  const [quantityNote, setQuantityNote] = useState('');
  const [actionError, setActionError] = useState('');

  const openTrade = (alert: BacktestSignalAlertV3) => {
    const currentLedger = loadLedgerSafely();
    const position = findStockPosition(currentLedger, alert.code);
    let effectiveAlert = alert;
    let note = '';
    let sellLimit: number | null = null;

    if (alert.action === 'sell') {
      sellLimit = maximumSellableShares(currentLedger, alert.code, new Date());
      const effectiveShares = Math.min(alert.suggestedShares, sellLimit);
      effectiveAlert = { ...alert, suggestedShares: effectiveShares };
      if (effectiveShares < alert.suggestedShares && effectiveShares > 0) {
        note = `当前可用持仓少于历史建议数量，已调整为最多可卖 ${effectiveShares.toLocaleString('zh-CN')} 股。`;
      }
    }

    setLedger(currentLedger);
    setTradePosition(position);
    setMaxSellShares(sellLimit);
    setQuantityNote(note);
    setActionError('');
    monitor.markRead(alert.id);
    setTradeAlert(effectiveAlert);
  };
  const confirmTrade = (input: StockTradeConfirmation) => {
    if (!tradeAlert) return;
    setActionError('');
    try {
      if (tradeAlert.action === 'buy') {
        const groupId = input.groupId === '__new__' ? `group-${Date.now()}` : input.groupId;
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
      setTradePosition(null);
      setQuantityNote('');
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
          position: 'absolute', top: '100%', right: 0,
          width: activeTab === 'forward' ? 820 : 470,
          maxWidth: activeTab === 'forward' ? '96vw' : '92vw',
          maxHeight: 620, overflowY: 'auto', marginTop: 6, zIndex: 100,
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
                  {marketStatusLabel(monitor.marketStatus)} · 最后扫描 {formatTime(monitor.lastScanAt)}
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
            <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
              <button
                type="button"
                disabled={activeTab === 'messages'}
                onClick={() => setActiveTab('messages')}
              >
                消息
              </button>
              <button
                type="button"
                disabled={activeTab === 'forward'}
                onClick={() => setActiveTab('forward')}
              >
                前向模拟记录
              </button>
            </div>
            <div style={{ color: '#9fb6b2', fontSize: '0.68rem', marginTop: 7 }}>
              监控{monitor.monitoringCount}只 · 自选{monitor.watchlistCount}只 · 持仓{monitor.heldCount}只
            </div>
            <div style={{ color: monitor.partialFailureCount > 0 ? '#f0b870' : '#70b8b0', fontSize: '0.68rem', marginTop: 3 }}>
              成功{monitor.successfulCount}只 · 失败{monitor.partialFailureCount}只
            </div>
            <div style={{ color: '#587575', fontSize: '0.66rem', marginTop: 3 }}>
              监控全部自选股、实际持仓与未平仓虚拟持仓；网站打开期间持续监听
            </div>
            {(monitor.error || actionError) && !tradeAlert && (
              <div role="alert" style={{ color: '#f87171', fontSize: '0.7rem', marginTop: 6 }}>
                {actionError || monitor.error}
              </div>
            )}
          </div>

          {activeTab === 'forward' ? (
            <ForwardSimulationPanel
              ledger={monitor.virtualLedger}
              prices={monitor.prices}
              onViewStock={viewStock}
              onViewAlert={alertId => {
                setActiveTab('messages');
                monitor.markRead(alertId);
              }}
            />
          ) : (
            <>
          {monitor.alerts.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#70b8b0', fontSize: '0.82rem' }}>
              暂无新的回测买卖信号
              <br />
              <span style={{ color: '#587575', fontSize: '0.7rem' }}>
                交易时段随 3 秒实时行情监听自选股与实际持仓
              </span>
            </div>
          ) : monitor.alerts.map(alert => {
            const position = findStockPosition(ledger, alert.code);
            const isBuy = alert.action === 'buy';
            const executed = alert.status !== 'pending';
            const pendingVirtualSell = alert.messageKind === 'virtual_pending';
            const missingRequiredPosition = (alert.intent === 'add' || !isBuy) && !position;
            const currentMaxSellable = !isBuy && position
              ? maximumSellableShares(ledger, alert.code, new Date())
              : 0;
            const unavailableSell = !isBuy && currentMaxSellable < 100;
            const label = intentLabel(alert.intent);
            const expectedAmount = alert.price * alert.suggestedShares;
            return (
              <article
                key={alert.id}
                style={{
                  padding: '12px 14px', borderBottom: '1px solid #243838',
                  borderLeft: `3px solid ${isBuy ? '#f56c6c' : '#67c23a'}`,
                  background: alert.readAt ? 'transparent' : '#102323',
                }}
              >
                <div style={{
                  display: 'inline-flex', alignItems: 'center', marginBottom: 7,
                  padding: '3px 7px', borderRadius: 999,
                  color: trackingColor(alert), background: '#0d1f1f',
                  border: '1px solid ' + trackingColor(alert) + '55',
                  fontSize: '0.66rem', fontWeight: 700,
                }}>
                  {trackingLabel(alert)}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: isBuy ? '#ff7b7b' : '#7dcc57', fontWeight: 'bold', fontSize: '0.8rem' }}>
                    {label} · 建议 {alert.suggestedShares.toLocaleString('zh-CN')} 股 · 触发价 ¥{alert.price.toFixed(2)}
                  </span>
                  <span style={{ color: '#587575', fontSize: '0.64rem' }}>
                    {new Date(alert.signalAt).toLocaleTimeString('zh-CN')}
                  </span>
                </div>
                <div style={{ color: '#d4a574', fontWeight: 'bold', fontSize: '0.84rem', marginTop: 7 }}>
                  {alert.name} ({alert.code})
                </div>
                <div style={{ color: '#d8e2df', fontSize: '0.72rem', marginTop: 4 }}>
                  预计金额 ¥{expectedAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  {' · '}{alert.reasons.join(' · ') || '回测策略状态变化'}
                </div>
                {alert.messageKind === 'virtual_execution' && alert.virtualPrice !== null && (
                  <div style={{ color: '#70b8b0', fontSize: '0.7rem', marginTop: 5 }}>
                    虚拟成交 {alert.virtualShares.toLocaleString('zh-CN')} 股 · ¥{alert.virtualPrice.toFixed(2)}
                    {alert.virtualPositionSharesAfter !== null
                      ? ' · 虚拟持仓 ' + alert.virtualPositionSharesAfter.toLocaleString('zh-CN') + ' 股'
                      : ''}
                  </div>
                )}
                {alert.messageKind === 'virtual_blocked' && (
                  <div style={{ color: '#f0b870', fontSize: '0.7rem', marginTop: 5 }}>
                    本次未生成虚拟卖出交易，等待可用股数解冻后重试
                  </div>
                )}
                {alert.messageKind === 'virtual_pending' && (
                  <div style={{ color: '#f0b870', fontSize: '0.7rem', marginTop: 5 }}>
                    {alert.virtualTrackingStatus === 'cancelled_revalidation'
                      ? '普通技术卖出在下一交易日复核时已失效，本次待卖任务已取消'
                      : '当日买入股份尚不可卖，系统将在下一交易日按实时价格复核处理'}
                  </div>
                )}
                {(alert.virtualTradeId || alert.virtualCycleId) && (
                  <details style={{ color: '#76928e', fontSize: '0.66rem', marginTop: 6 }}>
                    <summary style={{ cursor: 'pointer' }}>交易关联</summary>
                    <div style={{ marginTop: 4 }}>
                      交易ID：{alert.virtualTradeId ?? '无'} · 周期ID：{alert.virtualCycleId ?? '无'}
                    </div>
                  </details>
                )}
                {position && (
                  <div style={{ color: '#9fb6b2', fontSize: '0.7rem', marginTop: 5 }}>
                    当前持仓 {position.shares.toLocaleString('zh-CN')} 股 · 成本 ¥{position.averageCost.toFixed(2)}
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
                    aria-label={`执行${label} ${alert.name}`}
                    disabled={executed || pendingVirtualSell || missingRequiredPosition || unavailableSell}
                    onClick={() => openTrade(alert)}
                    style={{
                      color: '#fff', border: 0, borderRadius: 4, padding: '5px 10px',
                      cursor: executed || missingRequiredPosition || unavailableSell ? 'default' : 'pointer',
                      background: executed ? '#425454' : isBuy ? '#f56c6c' : '#67c23a',
                    }}
                  >
                    {executed ? executedLabel(alert) : `执行${label}`}
                  </button>
                </div>
              </article>
            );
          })}
            </>
          )}
        </div>
      )}

      {tradeAlert && (
        <>
          {quantityNote && (
            <div style={{
              position: 'fixed', left: '50%', top: 'calc(50% - 250px)', transform: 'translateX(-50%)',
              zIndex: 1001, color: '#f0b870', background: '#172727', padding: '6px 10px', borderRadius: 5,
            }}>
              {quantityNote}
            </div>
          )}
          <StockTradeConfirmDialog
            alert={tradeAlert}
            position={tradePosition}
            groups={ledger.groups}
            fixedBuyGroup={tradeAlert.intent === 'add' ? groupForPosition(ledger, tradePosition) : undefined}
            externalError={actionError}
            maxSellShares={tradeAlert.action === 'sell' ? maxSellShares ?? 0 : undefined}
            onConfirm={confirmTrade}
            onCancel={() => {
              setTradeAlert(null);
              setTradePosition(null);
              setMaxSellShares(null);
              setQuantityNote('');
              setActionError('');
            }}
          />
        </>
      )}
    </div>
  );
}
