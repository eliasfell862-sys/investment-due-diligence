import { useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import type { BacktestSignalAlertV3 } from '../backtest-signal-inbox-store';
import { calculateStockPositionAvailability } from '../stock-position-availability';
import { StockTradeConfirmDialog, type StockTradeConfirmation } from '../StockTradeConfirmDialog';
import { createCloudSecuritiesRepository } from './cloud-securities-repository';
import { useSecuritiesDataSource } from './SecuritiesDataSourceProvider';
import { useCloudSignalInbox } from './useCloudSignalInbox';

export function CloudSignalInbox() {
  const { user } = useAuth();
  if (!user) return null;
  return <AuthenticatedCloudSignalInbox userId={user.id} />;
}

function AuthenticatedCloudSignalInbox({ userId }: { userId: string }) {
  const inbox = useCloudSignalInbox(userId);
  const dataSource = useSecuritiesDataSource();
  const repository = useMemo(() => createCloudSecuritiesRepository(), []);
  const [open, setOpen] = useState(false);
  const [tradeAlert, setTradeAlert] = useState<BacktestSignalAlertV3 | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');
  const position = tradeAlert
    ? dataSource.ledger.positions.find(item => item.code === tradeAlert.code) ?? null
    : null;
  const maxSellShares = tradeAlert?.action === 'sell' && position
    ? calculateStockPositionAvailability(dataSource.ledger, tradeAlert.code, new Date()).availableShares
    : undefined;

  const beginTrade = async (alert: BacktestSignalAlertV3) => {
    setActionError('');
    await inbox.markRead(alert.id);
    setTradeAlert(alert);
  };

  const confirmTrade = async (input: StockTradeConfirmation) => {
    if (!tradeAlert) return;
    setSubmitting(true);
    setActionError('');
    const tradedAt = new Date().toISOString();
    try {
      if (tradeAlert.action === 'buy') {
        const groupId = input.groupId === '__new__' ? `group-${Date.now()}` : input.groupId;
        const groupName = input.groupId === '__new__'
          ? input.newGroupName
          : dataSource.ledger.groups.find(group => group.id === groupId)?.name ?? '默认持仓';
        await repository.executeBuy({
          alertId: tradeAlert.id,
          code: tradeAlert.code,
          name: tradeAlert.name,
          shares: input.shares,
          price: input.price,
          groupId,
          groupName,
          tradedAt,
        });
      } else {
        await repository.executeSell({
          alertId: tradeAlert.id,
          code: tradeAlert.code,
          shares: input.shares,
          price: input.price,
          tradedAt,
        });
      }
      await Promise.all([dataSource.reloadLedger(), inbox.reload()]);
      setTradeAlert(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label={`云端信号收件箱，${inbox.unreadCount}条未读`}
        onClick={() => setOpen(current => !current)}
        style={{
          position: 'relative', padding: '7px 12px', borderRadius: 6, cursor: 'pointer',
          color: '#d4a574', background: open ? '#1a3a3a' : '#0d1a1a',
          border: `1px solid ${inbox.unreadCount ? '#d4a574' : '#3a5a5a'}`,
        }}
      >
        📬
        {inbox.unreadCount > 0 && <strong style={{ marginLeft: 6 }}>{inbox.unreadCount}</strong>}
      </button>

      {open && (
        <section style={{
          position: 'absolute', right: 0, top: '100%', zIndex: 100, width: 480,
          maxWidth: '92vw', maxHeight: 560, overflowY: 'auto', padding: 14,
          background: '#172727', border: '1px solid #3a5a5a', borderRadius: 8,
          boxShadow: '0 10px 36px rgba(0,0,0,0.5)',
        }}>
          <header style={{ marginBottom: 12 }}>
            <strong style={{ color: '#d4a574' }}>云端实时信号收件箱</strong>
            <div style={{ color: '#70b8b0', fontSize: '0.72rem', marginTop: 4 }}>
              网页关闭期间的信号也会保存在这里
            </div>
          </header>
          {inbox.loading && <p>正在同步云端信号…</p>}
          {inbox.error && <p role="alert" style={{ color: '#f87171' }}>{inbox.error}</p>}
          {!inbox.loading && inbox.alerts.length === 0 && <p>暂时没有新的交易信号</p>}
          {inbox.alerts.map(alert => (
            <article key={alert.id} style={{ padding: '10px 0', borderTop: '1px solid #2a4242' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <strong>{alert.name}（{alert.code}）</strong>
                  <div style={{ fontSize: '0.76rem', color: '#9fb6b2', marginTop: 4 }}>
                    信号价 ¥{alert.price.toFixed(2)} · 建议 {alert.suggestedShares} 股
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#b8c8c5', marginTop: 4 }}>
                    {alert.reasons.join('；') || '策略条件已触发'}
                  </div>
                </div>
                {alert.status === 'pending' ? (
                  <button type="button" onClick={() => void beginTrade(alert)}>
                    {alert.action === 'buy' ? '执行买入' : '执行卖出'}
                  </button>
                ) : <span>{alert.status === 'bought' ? '已买入' : '已卖出'}</span>}
              </div>
            </article>
          ))}
        </section>
      )}

      {tradeAlert && (
        <StockTradeConfirmDialog
          alert={tradeAlert}
          position={position}
          groups={dataSource.ledger.groups}
          submitting={submitting}
          externalError={actionError}
          maxSellShares={maxSellShares}
          onConfirm={input => { void confirmTrade(input); }}
          onCancel={() => setTradeAlert(null)}
        />
      )}
    </div>
  );
}
