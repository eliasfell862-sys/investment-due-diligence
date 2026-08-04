import type { StockMarketSessionStatus } from '../../infrastructure/market-data/stock-market-session';

export interface RealtimeQuoteStatusProps {
  refreshing: boolean;
  marketStatus: StockMarketSessionStatus;
  lastUpdatedAt: string | null;
  stale: boolean;
  error: string;
  onRefresh: () => void;
}

const marketStatusLabels: Record<StockMarketSessionStatus, string> = {
  trading: '交易中 · 3秒自动刷新',
  lunch_break: '午间休市',
  closed: '已收盘',
  weekend: '周末休市',
};

function formatUpdateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知';
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

export function RealtimeQuoteStatus({
  refreshing,
  marketStatus,
  lastUpdatedAt,
  stale,
  error,
  onRefresh,
}: RealtimeQuoteStatusProps) {
  return (
    <div
      aria-label="实时行情状态"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 10,
        color: 'var(--sec-text-muted, #94a3b8)',
        fontSize: '0.82rem',
      }}
    >
      <span>{marketStatusLabels[marketStatus]}</span>
      {lastUpdatedAt && <span>最后更新：{formatUpdateTime(lastUpdatedAt)}</span>}
      {stale && <span style={{ color: 'var(--sec-warning, #f59e0b)' }}>行情可能已延迟</span>}
      {error && (
        <span title={error} style={{ color: 'var(--sec-warning, #f59e0b)' }}>
          行情暂时不可用，显示上次有效数据
        </span>
      )}
      <button
        type="button"
        className="button"
        disabled={refreshing}
        onClick={onRefresh}
        style={{ padding: '5px 12px', fontSize: '0.8rem' }}
      >
        {refreshing ? '刷新中…' : '立即刷新'}
      </button>
    </div>
  );
}
