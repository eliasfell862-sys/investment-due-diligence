import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { BacktestSignalAlert } from './backtest-signal-inbox-store';
import {
  calculateActualPortfolioSummary,
  calculateActualPositionMetrics,
} from './actual-position-metrics';
import { ActualPositionGroupDialog, type PositionGroupChange } from './ActualPositionGroupDialog';
import { RealtimeQuoteStatus } from './RealtimeQuoteStatus';
import {
  buyStockPosition,
  sellStockPosition,
  updateStockPositionGroup,
  type StockPosition,
} from './stock-position-ledger';
import { StockTradeConfirmDialog, type StockTradeConfirmation } from './StockTradeConfirmDialog';
import { useRealtimeStockQuotes } from './useRealtimeStockQuotes';
import { useStockPositionLedger } from './useStockPositionLedger';

export interface ActualPositionsPanelProps {
  projectId?: string;
}

function money(value: number): string {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signedMoney(value: number): string {
  return `${value >= 0 ? '+' : '-'}¥${Math.abs(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function signedPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function createManualAlert(
  position: StockPosition,
  action: 'buy' | 'sell',
  price: number,
): BacktestSignalAlert {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id: `manual-portfolio-${action}-${position.code}-${suffix}`,
    code: position.code,
    name: position.name,
    price,
    action,
    intent: action === 'buy' ? 'add' : 'exit',
    suggestedShares: action === 'buy' ? 100 : position.shares,
    positionSharesAtSignal: position.shares,
    reasons: ['用户从实际持仓管理确认交易'],
    signalAt: new Date().toISOString(),
    status: 'pending', readAt: null, executedAt: null,
    entryPrice: price, stopLoss: price,
    metrics: {
      totalTrades: 0, winRate: 0, sharpeRatio: 0,
      maxDrawdown: 0, annualReturn: 0, profitFactor: 0,
    },
  };
}

export function ActualPositionsPanel({ projectId }: ActualPositionsPanelProps) {
  const navigate = useNavigate();
  const positionLedger = useStockPositionLedger();
  const [trade, setTrade] = useState<{
    position: StockPosition;
    alert: BacktestSignalAlert;
    groupName: string;
  } | null>(null);
  const [groupPosition, setGroupPosition] = useState<StockPosition | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');
  const codes = useMemo(
    () => positionLedger.ledger.positions.map(position => position.code).sort(),
    [positionLedger.ledger.positions],
  );
  const realtime = useRealtimeStockQuotes(codes);
  const rows = useMemo(() => positionLedger.ledger.positions.map(position => ({
    position,
    metrics: calculateActualPositionMetrics(position, realtime.quotes[position.code]),
  })), [positionLedger.ledger.positions, realtime.quotes]);
  const summary = useMemo(() => calculateActualPortfolioSummary(rows), [rows]);
  const watchlistUrl = `/projects/${projectId || 'default'}/securities/watchlist`;

  const openTrade = (position: StockPosition, action: 'buy' | 'sell', currentPrice: number | null) => {
    const groupName = positionLedger.ledger.groups.find(group => group.id === position.groupId)?.name ?? '默认持仓';
    setActionError('');
    setTrade({ position, alert: createManualAlert(position, action, currentPrice ?? 0), groupName });
  };

  const confirmTrade = (input: StockTradeConfirmation) => {
    if (!trade || submitting) return;
    setSubmitting(true);
    setActionError('');
    try {
      if (trade.alert.action === 'buy') {
        buyStockPosition({
          code: trade.position.code,
          name: trade.position.name,
          shares: input.shares,
          price: input.price,
          groupId: trade.position.groupId,
          groupName: trade.groupName,
          sourceAlertId: trade.alert.id,
          tradedAt: new Date().toISOString(),
        });
      } else {
        sellStockPosition({
          code: trade.position.code,
          shares: input.shares,
          price: input.price,
          sourceAlertId: trade.alert.id,
          tradedAt: new Date().toISOString(),
        });
      }
      positionLedger.reload();
      setTrade(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const confirmGroupChange = (input: PositionGroupChange) => {
    if (!groupPosition || submitting) return;
    setSubmitting(true);
    setActionError('');
    try {
      const groupId = input.groupId === '__new__' ? `group-${Date.now()}` : input.groupId;
      const groupName = input.groupId === '__new__'
        ? input.newGroupName
        : positionLedger.ledger.groups.find(group => group.id === groupId)?.name ?? '默认持仓';
      updateStockPositionGroup({
        code: groupPosition.code,
        groupId,
        groupName,
        updatedAt: new Date().toISOString(),
      });
      positionLedger.reload();
      setGroupPosition(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section aria-label="我的实际持仓">
      <h2 style={{ color: '#d4a574', margin: '0 0 12px' }}>我的实际持仓</h2>
      {positionLedger.error && (
        <div role="alert" style={{ color: '#f87171', marginBottom: 12 }}>{positionLedger.error}</div>
      )}
      <RealtimeQuoteStatus
        refreshing={realtime.refreshing}
        marketStatus={realtime.marketStatus}
        lastUpdatedAt={realtime.lastUpdatedAt}
        stale={realtime.stale}
        error={realtime.error}
        onRefresh={() => { void realtime.refreshNow(); }}
      />

      {rows.length === 0 ? (
        <div style={{ marginTop: 18, padding: 32, textAlign: 'center', background: '#1a2a2a', borderRadius: 8 }}>
          <div style={{ color: '#d4a574', fontWeight: 'bold', marginBottom: 10 }}>暂无实际持仓</div>
          <Link to={watchlistUrl} style={{ color: '#70b8b0' }}>前往自选股加入持仓</Link>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 8, margin: '16px 0' }}>
            <SummaryCard label="持仓股票" value={`${summary.positionCount} 只`} />
            <SummaryCard label="持仓成本" value={money(summary.totalCost)} />
            <SummaryCard label="持仓市值" value={summary.marketValue === null ? '—' : money(summary.marketValue)} />
            <SummaryCard
              label="浮动盈亏"
              value={summary.floatingProfit === null ? '—' : signedMoney(summary.floatingProfit)}
              color={summary.floatingProfit !== null && summary.floatingProfit < 0 ? '#67c23a' : '#f56c6c'}
            />
          </div>
          {summary.unpricedCount > 0 && (
            <div style={{ color: '#f0b870', fontSize: '0.76rem', marginBottom: 10 }}>
              行情不完整：{summary.unpricedCount} 只股票暂无有效实时价格
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>代码</th><th>股票</th><th>持仓组</th><th>股数</th><th>成本价</th>
                  <th>实时价</th><th>市值</th><th>浮动盈亏</th><th>盈亏率</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ position, metrics }) => {
                  const groupName = positionLedger.ledger.groups.find(group => group.id === position.groupId)?.name ?? '默认持仓';
                  const profitColor = metrics.floatingProfit !== null && metrics.floatingProfit < 0 ? '#67c23a' : '#f56c6c';
                  return (
                    <tr key={position.id}>
                      <td>{position.code}</td>
                      <td>{position.name}</td>
                      <td>{groupName}</td>
                      <td>{position.shares} 股</td>
                      <td>{money(position.averageCost)}</td>
                      <td>{metrics.currentPrice === null ? '暂无行情' : money(metrics.currentPrice)}</td>
                      <td>{metrics.marketValue === null ? '—' : money(metrics.marketValue)}</td>
                      <td style={{ color: profitColor }}>
                        {metrics.floatingProfit === null ? '—' : signedMoney(metrics.floatingProfit)}
                      </td>
                      <td style={{ color: profitColor }}>
                        {metrics.floatingProfitRate === null ? '—' : signedPercent(metrics.floatingProfitRate)}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', minWidth: 210 }}>
                          <button type="button" aria-label={`补仓 ${position.name}`} onClick={() => openTrade(position, 'buy', metrics.currentPrice)}>补仓</button>
                          <button type="button" aria-label={`卖出 ${position.name}`} onClick={() => openTrade(position, 'sell', metrics.currentPrice)}>卖出</button>
                          <button type="button" aria-label={`调整持仓组 ${position.name}`} onClick={() => { setActionError(''); setGroupPosition(position); }}>调组</button>
                          <button
                            type="button"
                            aria-label={`查看个股 ${position.name}`}
                            onClick={() => navigate(`/projects/${projectId || 'default'}/securities/stock/${position.code}`)}
                          >查看</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {trade && (
        <StockTradeConfirmDialog
          alert={trade.alert}
          position={trade.position}
          groups={positionLedger.ledger.groups}
          fixedBuyGroup={trade.alert.action === 'buy'
            ? { id: trade.position.groupId, name: trade.groupName }
            : undefined}
          priceLabel={trade.alert.price > 0 ? '最新价' : '暂无实时价'}
          submitting={submitting}
          externalError={actionError}
          onConfirm={confirmTrade}
          onCancel={() => { if (!submitting) setTrade(null); }}
        />
      )}
      {groupPosition && (
        <ActualPositionGroupDialog
          stockName={groupPosition.name}
          currentGroupId={groupPosition.groupId}
          groups={positionLedger.ledger.groups}
          submitting={submitting}
          externalError={actionError}
          onConfirm={confirmGroupChange}
          onCancel={() => { if (!submitting) setGroupPosition(null); }}
        />
      )}
    </section>
  );
}

function SummaryCard({ label, value, color = '#d4a574' }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: '#1a2a2a', border: '1px solid #2a4a4a', borderRadius: 8, padding: 12 }}>
      <div style={{ color: '#70b8b0', fontSize: '0.72rem' }}>{label}</div>
      <div style={{ color, fontWeight: 'bold', marginTop: 4 }}>{value}</div>
    </div>
  );
}
