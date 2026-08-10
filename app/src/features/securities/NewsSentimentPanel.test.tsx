import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewsSentimentPanel } from './NewsSentimentPanel';

vi.mock('../../infrastructure/news/news-api', () => ({
  fetchStockNews: vi.fn(),
}));
vi.mock('../../infrastructure/news/future-events-api', () => ({
  fetchFutureEvents: vi.fn(),
}));

import { fetchStockNews } from '../../infrastructure/news/news-api';
import { fetchFutureEvents } from '../../infrastructure/news/future-events-api';

const mockedFetch = vi.mocked(fetchStockNews);
const mockedFuture = vi.mocked(fetchFutureEvents);

function emptyNewsMeta() {
  return { source: '东方财富个股公告', mode: 'realtime' as const, status: 'success' as const, asOf: '2026-08-10' };
}
function emptyFutureMeta() {
  return { source: '东方财富未来事件', mode: 'realtime' as const, status: 'success' as const, asOf: '2026-08-10' };
}

describe('NewsSentimentPanel', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedFuture.mockReset();
    // 默认两个数据源都返回空成功，各测试按需覆盖
    mockedFetch.mockResolvedValue({ data: [], meta: emptyNewsMeta() });
    mockedFuture.mockResolvedValue({ data: [], meta: emptyFutureMeta() });
  });

  it('renders overall sentiment badge and per-item labels from real announcements', async () => {
    mockedFetch.mockResolvedValue({
      data: [
        { id: 'a', title: 'XX:2026年半年度业绩预增公告', columnName: '业绩预告', noticeDate: '2026-08-10', stockCode: '600519', stockName: '贵州茅台' },
        { id: 'b', title: 'XX:关于收到立案告知书的公告', columnName: '其他', noticeDate: '2026-08-08', stockCode: '600519', stockName: '贵州茅台' },
      ],
      meta: emptyNewsMeta(),
    });

    render(<NewsSentimentPanel code="600519" />);

    expect(await screen.findByText(/看多 1 · 中性 0 · 看空 1/)).toBeInTheDocument();
    expect(screen.getByText(/业绩预增公告/)).toBeInTheDocument();
    // 标题 + 关键词标签都会出现该词，用 getAllByText 断言至少一条
    expect(screen.getAllByText(/立案告知书/).length).toBeGreaterThan(0);
  });

  it('shows the degraded warning when the news source reports an error', async () => {
    mockedFetch.mockResolvedValue({
      data: [],
      meta: { source: '东方财富个股公告', mode: 'realtime' as const, status: 'error' as const, asOf: '2026-08-10', error: 'request failed: 500' },
    });

    render(<NewsSentimentPanel code="600519" />);

    expect(await screen.findByText(/request failed: 500/)).toBeInTheDocument();
  });

  it('shows empty state when there are no announcements', async () => {
    render(<NewsSentimentPanel code="600519" />);

    expect(await screen.findByText(/近期暂无公告/)).toBeInTheDocument();
  });

  it('renders upcoming future events with concrete dates', async () => {
    mockedFuture.mockResolvedValue({
      data: [
        { date: '2026-08-31', title: '2026年半年报披露截止（法定）', type: 'report' },
        { date: '2026-09-01', title: '限售股解禁，解禁市值90.8亿', type: 'unlock' },
        { date: '2026-08-20', title: '除权除息：10派280.2423元', type: 'dividend' },
      ],
      meta: emptyFutureMeta(),
    });

    render(<NewsSentimentPanel code="600519" />);

    expect(await screen.findByText(/半年报披露截止/)).toBeInTheDocument();
    expect(screen.getByText(/限售股解禁，解禁市值90.8亿/)).toBeInTheDocument();
    expect(screen.getByText(/除权除息：10派280.2423元/)).toBeInTheDocument();
    // 具体日期出现
    expect(screen.getAllByText(/2026-08-\d{2}/).length).toBeGreaterThan(0);
  });
});
