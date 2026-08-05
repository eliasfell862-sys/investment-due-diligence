import { useState } from 'react';
import type { StockPositionGroup } from './stock-position-ledger';

export interface PositionGroupChange {
  groupId: string;
  newGroupName: string;
}

export interface ActualPositionGroupDialogProps {
  stockName: string;
  currentGroupId: string;
  groups: StockPositionGroup[];
  submitting?: boolean;
  externalError?: string;
  onConfirm(input: PositionGroupChange): void;
  onCancel(): void;
}

export function ActualPositionGroupDialog({
  stockName,
  currentGroupId,
  groups,
  submitting = false,
  externalError = '',
  onConfirm,
  onCancel,
}: ActualPositionGroupDialogProps) {
  const [groupId, setGroupId] = useState(currentGroupId);
  const [newGroupName, setNewGroupName] = useState('');
  const [error, setError] = useState('');

  const submit = () => {
    setError('');
    const trimmedName = newGroupName.trim();
    if (groupId === '__new__' && !trimmedName) {
      setError('请输入新持仓组名称');
      return;
    }
    onConfirm({ groupId, newGroupName: trimmedName });
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`调整持仓组 ${stockName}`}
        style={{
          width: 'min(420px, 100%)', background: 'var(--sec-surface-1, #172727)',
          border: '1px solid var(--sec-border-strong, #3a5a5a)', borderRadius: 10,
          padding: 20, boxShadow: '0 18px 60px rgba(0,0,0,0.5)',
        }}
      >
        <h3 style={{ margin: '0 0 16px', color: 'var(--sec-text, #f3eee4)' }}>
          调整持仓组 · {stockName}
        </h3>
        <label style={{ display: 'block', color: 'var(--sec-text-muted, #b8c8c5)', marginBottom: 12 }}>
          <span style={{ display: 'block', fontSize: '0.76rem', marginBottom: 5 }}>目标持仓组</span>
          <select
            aria-label="目标持仓组"
            value={groupId}
            onChange={event => setGroupId(event.target.value)}
            style={{ width: '100%', padding: '9px 10px', borderRadius: 5 }}
          >
            {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
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
        {(externalError || error) && (
          <div role="alert" style={{ color: '#f87171', fontSize: '0.78rem', marginBottom: 12 }}>
            {externalError || error}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onCancel} disabled={submitting} style={{ padding: '8px 16px' }}>
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            style={{ padding: '8px 16px', border: 0, borderRadius: 5, color: '#fff', background: '#409eff' }}
          >
            {submitting ? '提交中...' : '确认调整'}
          </button>
        </div>
      </div>
    </div>
  );
}
