import { useState } from 'react';

export interface VirtualCapitalCleanupPreview {
  previewId: string;
  snapshotHash: string;
  snapshotAt: string;
  originalTransactionCount: number;
  retainedTransactionCount: number;
  removedTransactionCount: number;
  endingCash: number;
  containsEstimatedFees: boolean;
}

export interface VirtualCapitalCleanupDialogProps {
  preview: VirtualCapitalCleanupPreview;
  applying?: boolean;
  stale?: boolean;
  error?: string;
  onApply(previewId: string, snapshotHash: string): void;
  onCancel(): void;
}

const CONFIRMATION_TEXT = '确认清理超额虚拟交易';

function money(value: number): string {
  return `¥${value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function VirtualCapitalCleanupDialog({
  preview,
  applying = false,
  stale = false,
  error = '',
  onApply,
  onCancel,
}: VirtualCapitalCleanupDialogProps) {
  const [confirmation, setConfirmation] = useState('');
  const confirmed = confirmation === CONFIRMATION_TEXT;
  const blocker = preview.containsEstimatedFees
    ? '预演包含估算手续费，必须先补齐准确费率后重新预演。'
    : stale ? '预演已失效，请重新生成清理预演。' : error;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="虚拟资金账本清理预演"
        style={{
          width: 'min(520px, 100%)', padding: 20, borderRadius: 10,
          color: '#d8e2df', background: '#172727', border: '1px solid #3a5a5a',
        }}
      >
        <h3 style={{ marginTop: 0, color: '#d4a574' }}>虚拟资金账本清理预演</h3>
        <div>原始交易 {preview.originalTransactionCount} 笔</div>
        <div>保留交易 {preview.retainedTransactionCount} 笔</div>
        <div>拟删除交易 {preview.removedTransactionCount} 笔</div>
        <div>清理后可用现金 {money(preview.endingCash)}</div>
        <div>快照时间 {new Date(preview.snapshotAt).toLocaleString('zh-CN')}</div>
        {blocker && (
          <div role="alert" style={{ color: '#f87171', marginTop: 10 }}>{blocker}</div>
        )}
        <p style={{ color: '#f0b870' }}>
          本操作不会自动执行。请核对预演结果，并输入“{CONFIRMATION_TEXT}”。
        </p>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ display: 'block', marginBottom: 6 }}>确认文字</span>
          <input
            aria-label="确认文字"
            value={confirmation}
            disabled={applying}
            onChange={event => setConfirmation(event.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', padding: 9 }}
          />
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onCancel} disabled={applying}>取消</button>
          <button
            type="button"
            disabled={!confirmed || applying || stale || preview.containsEstimatedFees}
            onClick={() => {
              if (!confirmed || applying || stale || preview.containsEstimatedFees) return;
              onApply(preview.previewId, preview.snapshotHash);
            }}
          >
            执行账本清理
          </button>
        </div>
      </div>
    </div>
  );
}
