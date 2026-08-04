import { useMemo, useState } from 'react';
import type { BacktestSignalAlert } from './backtest-signal-inbox-store';
import type { StockPosition, StockPositionGroup } from './stock-position-ledger';

export interface StockTradeConfirmation {
  shares: number;
  price: number;
  groupId: string;
  newGroupName: string;
}

export interface StockTradeConfirmDialogProps {
  alert: BacktestSignalAlert;
  position: StockPosition | null;
  groups: StockPositionGroup[];
  onConfirm(input: StockTradeConfirmation): void;
  onCancel(): void;
}

export function StockTradeConfirmDialog({
  alert,
  position,
  groups,
  onConfirm,
  onCancel,
}: StockTradeConfirmDialogProps) {
  const isBuy = alert.action === 'buy';
  const availableGroups = useMemo(() => {
    const items = groups.some(group => group.id === 'default')
      ? groups
      : [{ id: 'default', name: '默认持仓' }, ...groups];
    return items;
  }, [groups]);
  const [shares, setShares] = useState(isBuy ? 100 : position?.shares ?? 0);
  const [price, setPrice] = useState(alert.price);
  const [groupId, setGroupId] = useState(isBuy ? 'default' : position?.groupId ?? 'default');
  const [newGroupName, setNewGroupName] = useState('');
  const [error, setError] = useState('');

  const submit = () => {
    setError('');
    if (!Number.isFinite(price) || price <= 0) {
      setError('成交价格必须大于0');
      return;
    }
    if (!Number.isInteger(shares) || shares <= 0) {
      setError('交易股数必须是正整数');
      return;
    }
    if (isBuy && shares % 100 !== 0) {
      setError('买入股数必须是100股的整数倍');
      return;
    }
    if (!isBuy && (!position || shares > position.shares)) {
      setError(position ? '卖出股数不能超过当前持仓' : '当前没有该股票持仓');
      return;
    }
    if (isBuy && groupId === '__new__' && !newGroupName.trim()) {
      setError('请输入新持仓组名称');
      return;
    }
    onConfirm({ shares, price, groupId, newGroupName: newGroupName.trim() });
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${isBuy ? '确认买入' : '确认卖出'} ${alert.name}`}
        style={{
          width: 'min(420px, 100%)', background: 'var(--sec-surface-1, #172727)',
          border: '1px solid var(--sec-border-strong, #3a5a5a)', borderRadius: 10,
          padding: 20, boxShadow: '0 18px 60px rgba(0,0,0,0.5)',
        }}
      >
        <h3 style={{ margin: '0 0 6px', color: 'var(--sec-text, #f3eee4)' }}>
          {isBuy ? '确认买入' : '确认卖出'} {alert.name}
        </h3>
        <div style={{ color: 'var(--sec-text-secondary, #9fb6b2)', fontSize: '0.78rem', marginBottom: 18 }}>
          {alert.code} · 信号价 ¥{alert.price.toFixed(2)}
          {!isBuy && position ? ` · 当前持仓 ${position.shares} 股 · 成本 ¥${position.averageCost.toFixed(2)}` : ''}
        </div>

        <label style={{ display: 'block', color: 'var(--sec-text-muted, #b8c8c5)', marginBottom: 12 }}>
          <span style={{ display: 'block', fontSize: '0.76rem', marginBottom: 5 }}>交易股数</span>
          <input
            aria-label="交易股数"
            type="number"
            min="1"
            step={isBuy ? 100 : 1}
            value={shares}
            onChange={event => setShares(Number(event.target.value))}
            style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px', borderRadius: 5 }}
          />
        </label>

        <label style={{ display: 'block', color: 'var(--sec-text-muted, #b8c8c5)', marginBottom: 12 }}>
          <span style={{ display: 'block', fontSize: '0.76rem', marginBottom: 5 }}>成交价格</span>
          <input
            aria-label="成交价格"
            type="number"
            min="0.01"
            step="0.01"
            value={price}
            onChange={event => setPrice(Number(event.target.value))}
            style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px', borderRadius: 5 }}
          />
        </label>

        {isBuy && (
          <>
            <label style={{ display: 'block', color: 'var(--sec-text-muted, #b8c8c5)', marginBottom: 12 }}>
              <span style={{ display: 'block', fontSize: '0.76rem', marginBottom: 5 }}>目标持仓组</span>
              <select
                aria-label="目标持仓组"
                value={groupId}
                onChange={event => setGroupId(event.target.value)}
                style={{ width: '100%', padding: '9px 10px', borderRadius: 5 }}
              >
                {availableGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
                <option value="__new__">新建持仓组</option>
              </select>
            </label>
            {groupId === '__new__' && (
              <label style={{ display: 'block', color: 'var(--sec-text-muted, #b8c8c5)', marginBottom: 12 }}>
                <span style={{ display: 'block', fontSize: '0.76rem', marginBottom: 5 }}>新持仓组名称</span>
                <input
                  aria-label="新持仓组名称"
                  value={newGroupName}
                  onChange={event => setNewGroupName(event.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px', borderRadius: 5 }}
                />
              </label>
            )}
          </>
        )}

        {error && <div role="alert" style={{ color: '#f87171', fontSize: '0.78rem', marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onCancel} style={{ padding: '8px 16px' }}>取消</button>
          <button
            type="button"
            onClick={submit}
            style={{
              padding: '8px 16px', border: 'none', borderRadius: 5, color: '#fff', cursor: 'pointer',
              background: isBuy ? '#f56c6c' : '#67c23a',
            }}
          >
            {isBuy ? '确认买入' : '确认卖出'}
          </button>
        </div>
      </div>
    </div>
  );
}
