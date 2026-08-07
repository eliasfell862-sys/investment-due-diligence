import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./SecuritiesWorkbenchPageBase', () => ({
  SecuritiesWorkbenchPage: () => <main>证券工作台主体</main>,
}));

vi.mock('./cloud/CloudMigrationPanel', () => ({
  CloudMigrationPanelFromSession: () => <aside>云迁移入口</aside>,
}));

import { SecuritiesWorkbenchWithCloudMigration } from './SecuritiesWorkbenchWithCloudMigration';

describe('SecuritiesWorkbenchWithCloudMigration', () => {
  it('adds cloud migration without changing the securities workbench body', () => {
    render(<SecuritiesWorkbenchWithCloudMigration />);

    expect(screen.getByText('云迁移入口')).toBeInTheDocument();
    expect(screen.getByText('证券工作台主体')).toBeInTheDocument();
  });
});
