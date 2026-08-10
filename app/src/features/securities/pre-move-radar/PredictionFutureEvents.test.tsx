import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PredictionFutureEvents } from './PredictionFutureEvents';

vi.mock('../../../infrastructure/news/future-events-api', () => ({
  fetchFutureEvents: vi.fn(),
}));

import { fetchFutureEvents } from '../../../infrastructure/news/future-events-api';

const mocked = vi.mocked(fetchFutureEvents);

function meta(status: 'success' | 'error') {
  return { source: '东方财富未来事件', mode: 'realtime' as const, status, asOf: '2026-08-10' } as {
    source: string; mode: 'realtime'; status: 'success' | 'error'; asOf: string;
  };
}

describe('PredictionFutureEvents', () => {
  beforeEach(() => { mocked.mockReset(); });

  it('renders the event line with concrete dates when events exist', async () => {
    mocked.mockResolvedValue({
      data: [
        { date: '2026-08-31', title: '2026年半年报披露截止（法定）', type: 'report' },
        { date: '2026-09-01', title: '限售股解禁，解禁市值90.8亿', type: 'unlock' },
      ],
      meta: meta('success'),
    });

    render(<PredictionFutureEvents code="600519" />);

    expect(await screen.findByText(/2026-08-31 2026年半年报披露截止/)).toBeInTheDocument();
    expect(screen.getByText(/限售股解禁/)).toBeInTheDocument();
  });

  it('renders nothing when there are no upcoming events', async () => {
    mocked.mockResolvedValue({ data: [], meta: meta('success') });
    const { container } = render(<PredictionFutureEvents code="600519" />);
    await new Promise(r => setTimeout(r, 10));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the fetch fails (graceful silence)', async () => {
    mocked.mockResolvedValue({ data: [], meta: meta('error') });
    const { container } = render(<PredictionFutureEvents code="600519" />);
    await new Promise(r => setTimeout(r, 10));
    expect(container).toBeEmptyDOMElement();
  });
});
