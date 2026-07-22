import type { ReactNode } from 'react';

export interface StatusBadgeProps {
  readonly tone: 'good' | 'warning' | 'danger';
  readonly children: ReactNode;
  readonly ariaLabel?: string;
  readonly live?: boolean;
}

export function StatusBadge({
  tone,
  children,
  ariaLabel,
  live = false,
}: StatusBadgeProps) {
  return (
    <span
      className={`status-badge status-${tone}`}
      data-tone={tone}
      role={live ? 'status' : undefined}
      aria-label={ariaLabel}
      aria-live={live ? 'polite' : undefined}
    >
      {children}
    </span>
  );
}
