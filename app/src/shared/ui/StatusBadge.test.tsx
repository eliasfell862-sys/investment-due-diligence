import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it.each(['good', 'warning', 'danger'] as const)(
    'announces visible status text and exposes the %s tone',
    (tone) => {
      render(<StatusBadge tone={tone}>审核状态</StatusBadge>);

      const badge = screen.getByRole('status');
      expect(badge).toHaveTextContent('审核状态');
      expect(badge).toHaveAttribute('aria-live', 'polite');
      expect(badge).toHaveAttribute('data-tone', tone);
      expect(badge).toHaveClass('status-badge', `status-${tone}`);
    },
  );
});
