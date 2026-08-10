import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewsSentimentPanel } from './NewsSentimentPanel';

vi.mock('../../infrastructure/news/news-api', () => ({
  fetchStockNews: vi.fn(),
}));

import { fetchStockNews } from '../../infrastructure/news/news-api';

const mockedFetch = vi.mocked(fetchStockNews);

describe('NewsSentimentPanel', () => {
  beforeEach(() => { mockedFetch.mockReset(); });

  it('renders overall sentiment badge and per-item labels from real announcements', async () => {
    mockedFetch.mockResolvedValue({
      data: [
        { id: 'a', title: 'XX:2026年半年度业绩预增公告', columnName: '业绩预告', noticeDate: '2026-08-10', stockCode: '600519', stockName: '贵州茅台' },
        { id: 'b', title: 'XX:关于收到立案告知书的公告', columnName: '其他', noticeDate: '2026-08-08', stockCode: '600519', stockName: '贵州茅台' },
      ],
      meta: { source: '东方财富个股公告', mode: 'realtime' as const, status: 'success' as const, asOf: '2026-08-10' },
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
    mockedFetch.mockResolvedValue({
      data: [],
      meta: { source: '东方财富个股公告', mode: 'realtime' as const, status: 'success' as const, asOf: '2026-08-10' },
    });

    render(<NewsSentimentPanel code="600519" />);

    expect(await screen.findByText(/近期暂无公告/)).toBeInTheDocument();
  });
});
