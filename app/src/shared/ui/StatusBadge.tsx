import type { ReactNode } from 'react';

export interface StatusBadgeProps {
  readonly tone: 'good' | 'warning' | 'danger';
  readonly children: ReactNode;
  readonly ariaLabel?: string;
}

export function StatusBadge({ tone, children, ariaLabel }: StatusBadgeProps) {
  return (
    <span
      className={`status-badge status-${tone}`}
      data-tone={tone}
      role="status"
      aria-label={ariaLabel}
      aria-live="polite"
    >
      {children}
    </span>
  );
}
