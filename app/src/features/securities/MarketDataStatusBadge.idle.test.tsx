import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarketDataStatusBadge } from './MarketDataStatusBadge';

describe('MarketDataStatusBadge idle and empty states', () => {
  it('shows not requested instead of success before a request is possible', () => {
    render(<MarketDataStatusBadge meta={{
      source: 'Tencent Fund',
      mode: 'delayed',
      status: 'idle',
    }} />);

    expect(screen.getByText('未请求')).toBeInTheDocument();
  });

  it('shows an explicit empty state for a successful request with no records', () => {
    render(<MarketDataStatusBadge meta={{
      source: 'Directory',
      mode: 'cached',
      status: 'empty',
    }} />);

    expect(screen.getByText('无数据')).toBeInTheDocument();
  });
});
