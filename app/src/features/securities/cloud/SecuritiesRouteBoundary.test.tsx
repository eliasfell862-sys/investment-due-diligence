import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../infrastructure/cloud/cloud-environment', () => ({
  readAuthEnvironment: () => ({ supabaseUrl: 'https://example.test', supabaseAnonKey: 'anon' }),
  readCloudEnvironment: () => null,
}));

vi.mock('./SecuritiesDataSourceProvider', () => ({
  SecuritiesDataSourceProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="securities-data-source">{children}</div>
  ),
}));

import { SecuritiesRouteBoundary } from './SecuritiesRouteBoundary';

describe('SecuritiesRouteBoundary', () => {
  it('places configured cloud securities routes inside the shared data source', () => {
    render(<SecuritiesRouteBoundary><main>证券页面</main></SecuritiesRouteBoundary>);
    expect(screen.getByTestId('securities-data-source')).toContainElement(screen.getByText('证券页面'));
  });
});
