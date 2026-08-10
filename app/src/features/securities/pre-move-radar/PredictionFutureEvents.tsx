/**
 * 预测卡片的未来事件标签 —— 为 pre-move 雷达 Top 预测展示近期催化剂。
 *
 * 抓取未来 45 天事件（定期报告/除权除息/解禁），有事件才显示一行 🔔，
 * 无事件或失败时静默不渲染（不打扰卡片）。
 */
import { useEffect, useState } from 'react';
import { fetchFutureEvents } from '../../../infrastructure/news/future-events-api';
import type { FutureEvent } from '../../../engines/market-analysis/future-events-engine';

export function PredictionFutureEvents({ code }: { code: string }) {
  const [events, setEvents] = useState<FutureEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFutureEvents(code)
      .then(res => {
        if (cancelled) return;
        if (res.meta.status === 'success') setEvents(res.data);
        else setEvents([]); // 失败视为无事件，静默
      })
      .catch(() => { if (!cancelled) setEvents([]); });
    return () => { cancelled = true; };
  }, [code]);

  if (!events || events.length === 0) return null;

  return (
    <div style={{ fontSize: '.78rem', color: 'var(--sec-warning)', marginTop: 8, lineHeight: 1.6 }}>
      🔔 {events.map(e => `${e.date || '待定'} ${e.title}`).join('；')}
    </div>
  );
}
