import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type {
  BacktestSignalAlert,
  BacktestSignalAlertV3,
  TTradeMessageKind,
} from './backtest-signal-inbox-store';
import {
  calculateActualPortfolioSummary,
  calculateActualPositionMetrics,
} from './actual-position-metrics';
import { calculateStockPositionAvailability } from './stock-position-availability';
import { ActualPositionGroupDialog, type PositionGroupChange } from './ActualPositionGroupDialog';
import { RealtimeQuoteStatus } from './RealtimeQuoteStatus';
import type { StockPosition } from './stock-position-ledger';
import { StockTradeConfirmDialog, type StockTradeConfirmation } from './StockTradeConfirmDialog';
import { useRealtimeStockQuotes } from './useRealtimeStockQuotes';
import { useStockPositionLedger } from './useStockPositionLedger';
import { useOptionalRealtimeBacktestMonitorContext } from './RealtimeBacktestMonitorProvider';
import { useTTradingState } from './t-trading/useTTradingState';
import { TradingFeeProfileDialog } from './t-trading/TradingFeeProfileDialog';
import { TTradePositionSummary } from './t-trading/TTradePositionSummary';
import { useForegroundTTradePlans } from './t-trading/useForegroundTTradePlans';
import { DEFAULT_TRADING_FEE_PROFILE } from './t-trading/t-trading-types';

export interface ActualPositionsPanelProps {
  projectId?: string;
}

type ActualTTradeMessageKind = Exclude<TTradeMessageKind, `virtual_${string}`>;

function isActualTTradeMessageKind(kind: TTradeMessageKind): kind is ActualTTradeMessageKind {
  return kind === 'actual_t_sell'
    || kind === 'actual_t_buyback'
    || kind === 'actual_t_expiry_risk'
    || kind === 'actual_t_risk_review';
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
  availableShares: number,
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
    suggestedShares: action === 'buy' ? 100 : availableShares,
    positionSharesAtSignal: position.shares,
    availableSharesAtSignal: availableShares,
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
  const monitor = useOptionalRealtimeBacktestMonitorContext();
  const tTrading = useTTradingState();
  const [trade, setTrade] = useState<{
    position: StockPosition;
    alert: BacktestSignalAlert;
    groupName: string;
    maxSellShares: number;
  } | null>(null);
  const [groupPosition, setGroupPosition] = useState<StockPosition | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [feeDialogOpen, setFeeDialogOpen] = useState(false);
  const [feeSaving, setFeeSaving] = useState(false);
  const codes = useMemo(
    () => positionLedger.ledger.positions.map(position => position.code).sort(),
    [positionLedger.ledger.positions],
  );
  const realtime = useRealtimeStockQuotes(codes);
  const rows = useMemo(() => positionLedger.ledger.positions.map(position => ({
    position,
    metrics: calculateActualPositionMetrics(position, realtime.quotes[position.code]),
    availability: calculateStockPositionAvailability(
      positionLedger.ledger,
      position.code,
      realtime.lastUpdatedAt ?? new Date(),
    ),
  })), [positionLedger.ledger, realtime.lastUpdatedAt, realtime.quotes]);
  const foregroundPositions = useMemo(() => rows.map(({ position, availability }) => ({
    code: position.code,
    availableShares: availability.availableShares,
    averageCost: position.averageCost,
  })), [rows]);
  const foregroundTPlans = useForegroundTTradePlans({
    positions: foregroundPositions,
    quotes: realtime.quotes,
    quoteAt: realtime.lastUpdatedAt,
    marketStatus: realtime.marketStatus,
    feeProfile: tTrading.state.feeProfile,
  });
  const summary = useMemo(() => calculateActualPortfolioSummary(rows), [rows]);
  const realizedProfit = useMemo(() => positionLedger.ledger.transactions
    .filter(transaction => transaction.type === 'sell')
    .reduce((total, transaction) => total + transaction.realizedProfit, 0),
  [positionLedger.ledger.transactions]);
  const totalProfit = summary.floatingProfit === null
    ? null
    : realizedProfit + summary.floatingProfit;
  const watchlistUrl = `/projects/${projectId || 'default'}/securities/watchlist`;
  const defaultFeesActive =
    tTrading.state.feeProfile.commissionRate === DEFAULT_TRADING_FEE_PROFILE.commissionRate
    && tTrading.state.feeProfile.minimumCommission === DEFAULT_TRADING_FEE_PROFILE.minimumCommission
    && tTrading.state.feeProfile.sellStampDutyRate === DEFAULT_TRADING_FEE_PROFILE.sellStampDutyRate
    && tTrading.state.feeProfile.transferFeeRate === DEFAULT_TRADING_FEE_PROFILE.transferFeeRate
    && tTrading.state.feeProfile.slippageMode === DEFAULT_TRADING_FEE_PROFILE.slippageMode
    && tTrading.state.feeProfile.fixedSlippageRate === DEFAULT_TRADING_FEE_PROFILE.fixedSlippageRate;
  const pendingTAlerts: BacktestSignalAlertV3[] = (monitor?.alerts ?? [])
    .filter((alert): alert is BacktestSignalAlertV3 => alert.status === 'pending' && Boolean(alert.tTrade));
  const openTrade = (
    position: StockPosition,
    action: 'buy' | 'sell',
    currentPrice: number | null,
    availableShares: number,
  ) => {
    const groupName = positionLedger.ledger.groups.find(group => group.id === position.groupId)?.name ?? '默认持仓';
    setActionError('');
    setTrade({
      position,
      alert: createManualAlert(position, action, currentPrice ?? 0, availableShares),
      groupName,
      maxSellShares: availableShares,
    });
  };

  const confirmTrade = async (input: StockTradeConfirmation) => {
    if (!trade || submitting) return;
    setSubmitting(true);
    setActionError('');
    try {
      if (trade.alert.action === 'buy') {
        await positionLedger.buy({
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
        await positionLedger.sell({
          code: trade.position.code,
          shares: input.shares,
          price: input.price,
          sourceAlertId: trade.alert.id,
          tradedAt: new Date().toISOString(),
        });
      }
      setTrade(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const confirmGroupChange = async (input: PositionGroupChange) => {
    if (!groupPosition || submitting) return;
    setSubmitting(true);
    setActionError('');
    try {
      const groupId = input.groupId === '__new__' ? `group-${Date.now()}` : input.groupId;
      const groupName = input.groupId === '__new__'
        ? input.newGroupName
        : positionLedger.ledger.groups.find(group => group.id === groupId)?.name ?? '默认持仓';
      await positionLedger.moveGroup({
        code: groupPosition.code,
        groupId,
        groupName,
        updatedAt: new Date().toISOString(),
      });
      setGroupPosition(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (    <section aria-label="鎴戠殑瀹為檯鎸佷粨">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
        <h2 style={{ color: '#d4a574', margin: 0 }}>{'我的实际持仓'}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#829995', fontSize: '0.72rem' }}>{defaultFeesActive ? '默认费率' : '自定义费率'}</span>
          <button type="button" aria-label={'交易费率'} onClick={() => { setActionError(''); setFeeDialogOpen(true); }}>{'交易费率'}</button>
        </div>
      </div>      {positionLedger.error && (
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
            <SummaryCard
              label="总盈亏"
              value={totalProfit === null ? '—' : signedMoney(totalProfit)}
              color={totalProfit !== null && totalProfit < 0 ? '#67c23a' : '#f56c6c'}
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
                  <th>代码</th><th>股票</th><th>持仓组</th><th>全部 / 可用</th><th>成本价</th>
                  <th>实时价</th><th>市值</th><th>浮动盈亏</th><th>盈亏率</th><th>{'做 T 计划'}</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ position, metrics, availability }) => {
                  const groupName = positionLedger.ledger.groups.find(group => group.id === position.groupId)?.name ?? '默认持仓';
                  const profitColor = metrics.floatingProfit !== null && metrics.floatingProfit < 0 ? '#67c23a' : '#f56c6c';
                  const tAlert = pendingTAlerts.find(alert => alert.code === position.code) as BacktestSignalAlertV3 | undefined;
                  const tCycle = [...tTrading.state.cycles].reverse().find(cycle => (
                    cycle.positionId === position.id || cycle.code === position.code
                  )) ?? null;
                  const foregroundPlan = foregroundTPlans[position.code];
                  const tTrade = tAlert?.tTrade;
                  const formalTPlan = tTrade && isActualTTradeMessageKind(tTrade.kind) ? {
                    kind: tTrade.kind,
                    shares: tAlert.suggestedShares,
                    sellRange: tTrade.sellRange,
                    buybackRange: tTrade.buybackRange,
                    targetRange: tTrade.targetRange,
                  } : null;
                  const tPlan = formalTPlan ?? (!tCycle && foregroundPlan?.status === 'ready' ? {
                    kind: 'actual_t_sell' as const,
                    shares: foregroundPlan.shares,
                    sellRange: foregroundPlan.sellRange,
                    buybackRange: foregroundPlan.buybackRange,
                    targetRange: null,
                  } : null);
                  return (
                    <tr key={position.id}>
                      <td>{position.code}</td>
                      <td>{position.name}</td>
                      <td>{groupName}</td>
                      <td aria-label={`${availability.totalShares} ${availability.availableShares}`}>
                        <div>{availability.totalShares}</div>
                        <div style={{ color: 'var(--sec-text-muted, #94a3b8)', marginTop: 2 }}>
                          {availability.availableShares}
                        </div>
                      </td>
                      <td>{money(position.averageCost)}</td>
                      <td>{metrics.currentPrice === null ? '暂无行情' : money(metrics.currentPrice)}</td>
                      <td>{metrics.marketValue === null ? '—' : money(metrics.marketValue)}</td>
                      <td style={{ color: profitColor }}>
                        {metrics.floatingProfit === null ? '—' : signedMoney(metrics.floatingProfit)}
                      </td>
                      <td style={{ color: profitColor }}>
                        {metrics.floatingProfitRate === null ? '—' : signedPercent(metrics.floatingProfitRate)}
                      </td>
                      <td style={{ minWidth: 220 }}>
                        <TTradePositionSummary
                          alert={tPlan}
                          cycle={tCycle}
                          sampleInsufficient={tAlert?.tTrade?.sampleStatus === 'sample_insufficient'}
                          foregroundStatus={!formalTPlan && !tCycle ? foregroundPlan?.status : undefined}
                          foregroundError={!formalTPlan && !tCycle ? foregroundPlan?.error : undefined}
                        />
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', minWidth: 210 }}>
                          <button type="button" aria-label={`补仓 ${position.name}`} onClick={() => openTrade(position, 'buy', metrics.currentPrice, availability.availableShares)}>补仓</button>
                          <button type="button" aria-label={`卖出 ${position.name}`} disabled={availability.availableShares < 100} onClick={() => openTrade(position, 'sell', metrics.currentPrice, availability.availableShares)}>卖出</button>
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
      {feeDialogOpen && (
        <TradingFeeProfileDialog
          profile={tTrading.state.feeProfile}
          saving={feeSaving}
          externalError={actionError || tTrading.error}
          onSave={async profile => {
            setFeeSaving(true);
            setActionError('');
            try {
              await tTrading.saveTradingFeeProfile(profile);
              setFeeDialogOpen(false);
            } catch (error) {
              setActionError(error instanceof Error ? error.message : String(error));
            } finally {
              setFeeSaving(false);
            }
          }}
          onCancel={() => { if (!feeSaving) setFeeDialogOpen(false); }}
        />
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
          maxSellShares={trade.alert.action === 'sell' ? trade.maxSellShares : undefined}
          onConfirm={input => { void confirmTrade(input); }}
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
          onConfirm={input => { void confirmGroupChange(input); }}
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
