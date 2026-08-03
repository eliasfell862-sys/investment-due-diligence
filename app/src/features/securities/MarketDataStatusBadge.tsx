import type { MarketDataMeta } from '../../infrastructure/market-data/market-data-meta';

const MODE_LABELS = {
  realtime: '\u5b9e\u65f6',
  delayed: '\u5ef6\u8fdf',
  cached: '\u7f13\u5b58',
  static: '\u9759\u6001',
} as const;

const STATUS_LABELS = {
  loading: '\u52a0\u8f7d\u4e2d',
  success: '\u6210\u529f',
  stale: '\u5df2\u8fc7\u671f',
  error: '\u5931\u8d25',
} as const;

export function MarketDataStatusBadge({ meta }: { meta: MarketDataMeta }) {
  const color = meta.status === 'error'
    ? 'var(--sec-loss)'
    : meta.status === 'stale'
      ? 'var(--sec-warning)'
      : 'var(--sec-text-subtle)';
  const time = meta.asOf
    ? new Date(meta.asOf).toLocaleString('zh-CN', { hour12: false })
    : '\u65e0\u66f4\u65b0\u65f6\u95f4';

  return (
    <div
      role="status"
      title={meta.error || undefined}
      style={{
        display: 'inline-flex',
        gap: 6,
        alignItems: 'center',
        flexWrap: 'wrap',
        color,
        fontSize: '0.75rem',
      }}
    >
      <span>{'\u6765\u6e90\uff1a'}{meta.source}</span>
      <span>&middot;</span>
      <span>{MODE_LABELS[meta.mode]}</span>
      <span>&middot;</span>
      <span>{STATUS_LABELS[meta.status]}</span>
      <span>&middot;</span>
      <span>{time}</span>
    </div>
  );
