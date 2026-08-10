/**
 * 新闻情绪面板 —— 抓取个股东财公告并用情绪引擎评分展示。
 * 挂在个股分析页 StockDashboard 的"新闻情绪" Tab 下。
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { fetchStockNews } from '../../infrastructure/news/news-api';
import { fetchFutureEvents } from '../../infrastructure/news/future-events-api';
import type { FutureEvent } from '../../engines/market-analysis/future-events-engine';
import { analyzeNewsSentiment, type NewsSentimentResult, type SentimentLabel } from '../../engines/market-analysis/sentiment-engine';

const EVENT_TYPE_LABEL: Record<FutureEvent['type'], string> = {
  report: '📅',
  dividend: '💰',
  unlock: '🔓',
};

const LABEL_TEXT: Record<SentimentLabel, string> = {
  bullish: '看多',
  neutral: '中性',
  bearish: '看空',
};

const LABEL_COLOR: Record<SentimentLabel, string> = {
  bullish: '#f56c6c',   // A股习惯红涨
  neutral: '#c0b8a8',
  bearish: '#67c23a',   // 绿跌
};

export function NewsSentimentPanel({ code }: { code: string }) {
  const [result, setResult] = useState<NewsSentimentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [futureEvents, setFutureEvents] = useState<FutureEvent[] | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEventsError(null);
    setFutureEvents(null);
    fetchStockNews(code, 20)
      .then(res => {
        if (cancelled) return;
        setResult(analyzeNewsSentiment(res.data));
        if (res.meta.status === 'error') setError(res.meta.error || '新闻数据暂不可用');
      })
      .catch(() => { if (!cancelled) setError('新闻加载失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    fetchFutureEvents(code)
      .then(res => {
        if (cancelled) return;
        setFutureEvents(res.data);
        if (res.meta.status === 'error') setEventsError(res.meta.error || '未来事件数据暂不可用');
      })
      .catch(() => { if (!cancelled) setEventsError('未来事件加载失败'); });
    return () => { cancelled = true; };
  }, [code]);

  const panel: CSSProperties = { background: '#1a2a2a', borderRadius: 8, padding: 16, border: '1px solid #2a4a4a' };

  if (loading) {
    return <div style={panel}><p style={{ color: '#70b8b0', textAlign: 'center', padding: 24 }}>新闻情绪加载中…</p></div>;
  }

  if (!result) {
    return <div style={panel}><p style={{ color: '#f87171', textAlign: 'center', padding: 24 }}>{error || '暂无新闻数据'}</p></div>;
  }

  const overall = result.overallLabel;
  return (
    <div style={panel}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <h3 style={{ color: '#d4a574', margin: 0 }}>📰 新闻情绪</h3>
        <span style={{
          padding: '4px 14px', borderRadius: 6, fontWeight: 700, fontSize: '0.95rem',
          color: LABEL_COLOR[overall], background: `${LABEL_COLOR[overall]}1a`,
        }}>
          {LABEL_TEXT[overall]} {(result.overallScore >= 0 ? '+' : '')}{(result.overallScore * 100).toFixed(0)}
        </span>
        <span style={{ color: '#8ba8a8', fontSize: '0.82rem' }}>
          看多 {result.bullishCount} · 中性 {result.neutralCount} · 看空 {result.bearishCount}
        </span>
      </div>

      {error && <p style={{ color: '#f59e0b', fontSize: '0.8rem', margin: '0 0 12px' }}>⚠️ {error}</p>}

      {/* ── 未来事件（未来 45 天影响情绪/股价的日程） ── */}
      <div style={{ margin: '12px 0 16px', padding: '10px 14px', background: '#142424', borderRadius: 6, border: '1px solid #244040' }}>
        <div style={{ color: '#d4a574', fontWeight: 600, fontSize: '0.85rem', marginBottom: 8 }}>
          🔔 未来事件
          {futureEvents === null && <span style={{ color: '#5f7a7a', fontWeight: 400 }}>（加载中…）</span>}
        </div>
        {eventsError && <p style={{ color: '#f59e0b', fontSize: '0.78rem', margin: '0 0 8px' }}>⚠️ {eventsError}</p>}
        {futureEvents !== null && futureEvents.length === 0 && !eventsError && (
          <p style={{ color: '#5f7a7a', fontSize: '0.78rem', margin: 0 }}>未来 45 天内暂无已知事件</p>
        )}
        {futureEvents !== null && futureEvents.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {futureEvents.map((e, i) => (
              <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 0', fontSize: '0.8rem' }}>
                <span style={{ color: '#70b8b0', flexShrink: 0 }}>{EVENT_TYPE_LABEL[e.type]}</span>
                <span style={{ color: '#e6a23c', flexShrink: 0, minWidth: 76 }}>{e.date || '待定'}</span>
                <span style={{ color: '#d8e0e0' }}>{e.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {result.items.length === 0 ? (
        <p style={{ color: '#70b8b0', textAlign: 'center', padding: 20 }}>近期暂无公告</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 480, overflowY: 'auto' }}>
          {result.items.map((r, i) => (
            <li key={r.item.id || i} style={{
              display: 'flex', gap: 10, alignItems: 'flex-start',
              padding: '10px 4px', borderBottom: '1px solid #244040',
            }}>
              <span style={{
                flexShrink: 0, minWidth: 42, textAlign: 'center', padding: '2px 8px', borderRadius: 4,
                fontSize: '0.78rem', color: LABEL_COLOR[r.label], background: `${LABEL_COLOR[r.label]}1a`,
              }}>{LABEL_TEXT[r.label]}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#d8e0e0', fontSize: '0.85rem', wordBreak: 'break-all' }}>{r.item.title}</div>
                <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ color: '#5f7a7a', fontSize: '0.72rem' }}>{r.item.noticeDate || ''} {r.item.columnName || ''}</span>
                  {r.matchedKeywords.map((k, j) => (
                    <span key={j} style={{
                      fontSize: '0.68rem', padding: '1px 6px', borderRadius: 8,
                      color: k.weight > 0 ? '#f56c6c' : '#67c23a', background: '#142424',
                    }}>{k.keyword}</span>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
