import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it.each(['good', 'warning', 'danger'] as const)(
    'renders a static %s badge without creating a live region',
    (tone) => {
      render(<StatusBadge tone={tone}>审核状态</StatusBadge>);

      const badge = screen.getByText('审核状态');
      expect(badge).toHaveTextContent('审核状态');
      expect(badge).toHaveAttribute('data-tone', tone);
      expect(badge).toHaveClass('status-badge', `status-${tone}`);
      expect(badge).not.toHaveAttribute('role');
      expect(badge).not.toHaveAttribute('aria-live');
    },
  );

  it('creates a polite status live region only when requested', () => {
    render(
      <StatusBadge tone="warning" live ariaLabel="后台同步状态">
        同步中
      </StatusBadge>,
    );

    const badge = screen.getByRole('status', { name: '后台同步状态' });
    expect(badge).toHaveAttribute('aria-live', 'polite');
    expect(badge).toHaveTextContent('同步中');
  });
});
