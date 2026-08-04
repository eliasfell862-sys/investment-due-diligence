import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RealtimeQuoteStatus, type RealtimeQuoteStatusProps } from './RealtimeQuoteStatus';

function renderStatus(overrides: Partial<RealtimeQuoteStatusProps> = {}) {
  const props: RealtimeQuoteStatusProps = {
    refreshing: false,
    marketStatus: 'trading',
    lastUpdatedAt: null,
    stale: false,
    error: '',
    onRefresh: vi.fn(),
    ...overrides,
  };
  return { ...render(<RealtimeQuoteStatus {...props} />), props };
}

describe('RealtimeQuoteStatus', () => {
  it('renders trading status, update time, and manual refresh', async () => {
    const onRefresh = vi.fn();
    renderStatus({
      lastUpdatedAt: '2026-08-04T02:00:00.000Z',
      onRefresh,
    });
    expect(screen.getByText('交易中 · 3秒自动刷新')).toBeInTheDocument();
    expect(screen.getByText(/最后更新：/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '立即刷新' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('keeps the refresh button disabled while refreshing', () => {
    renderStatus({ refreshing: true });
    expect(screen.getByRole('button', { name: '刷新中…' })).toBeDisabled();
  });

  it('shows stale and last-good-data warnings without hiding the update time', () => {
    renderStatus({
      stale: true,
      error: 'network',
      lastUpdatedAt: '2026-08-04T02:00:00.000Z',
    });
    expect(screen.getByText('行情可能已延迟')).toBeInTheDocument();
    expect(screen.getByText('行情暂时不可用，显示上次有效数据')).toBeInTheDocument();
    expect(screen.getByText(/最后更新：/)).toBeInTheDocument();
  });

  it.each([
    ['lunch_break', '午间休市'],
    ['closed', '已收盘'],
    ['weekend', '周末休市'],
  ] as const)('maps %s to %s', (marketStatus, label) => {
    renderStatus({ marketStatus });
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
