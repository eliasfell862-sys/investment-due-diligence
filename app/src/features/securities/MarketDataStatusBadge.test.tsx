import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarketDataStatusBadge } from './MarketDataStatusBadge';

describe('MarketDataStatusBadge', () => {
  it('shows source, data mode, status and timestamp', () => {
    render(<MarketDataStatusBadge meta={{
      source: 'Tencent',
      mode: 'realtime',
      status: 'success',
      asOf: '2026-08-03T10:00:00.000Z',
    }} />);

    expect(screen.getByText(/Tencent/)).toBeInTheDocument();
    expect(screen.getByText(/\u5b9e\u65f6/)).toBeInTheDocument();
    expect(screen.getByText(/\u6210\u529f/)).toBeInTheDocument();
  });
});
