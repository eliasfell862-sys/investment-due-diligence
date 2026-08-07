import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudMigrationPanel, cloudMigrationCompletionKey } from './CloudMigrationPanel';

function seedLocalData() {
  localStorage.setItem('sec_watchlists_v2', JSON.stringify([{
    id: 'wl-1', name: '核心', createdAt: '2026-08-01T00:00:00.000Z',
    codes: ['000001', '600519'], groups: [], codeGroups: {},
  }]));
  localStorage.setItem('sec_stock_position_ledger_v1', JSON.stringify({
    version: 1,
    groups: [{ id: 'core', name: '核心持仓' }],
    positions: [{
      id: 'position-1', groupId: 'core', code: '000001', name: '平安银行', shares: 100,
      averageCost: 10, totalCost: 1_000, openedAt: '2026-08-03T01:30:00.000Z',
      updatedAt: '2026-08-03T01:30:00.000Z', sourceAlertIds: ['alert-1'],
    }],
    transactions: [{
      id: 'tx-1', groupId: 'core', code: '000001', name: '平安银行', type: 'buy', shares: 100,
      price: 10, amount: 1_000, tradedAt: '2026-08-03T01:30:00.000Z',
      sourceAlertId: 'alert-1', realizedProfit: 0,
    }],
  }));
  localStorage.setItem('sec_bt_signal_runtime_v3', JSON.stringify({
    version: 3, alerts: [], stocks: {},
    virtualLedger: { version: 1, positions: [], transactions: [], cycles: [] },
  }));
}

describe('CloudMigrationPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    seedLocalData();
  });

  it('shows exact local counts and requires explicit confirmation', async () => {
    const repository = { importLocalState: vi.fn().mockResolvedValue(undefined) };
    const user = userEvent.setup();
    render(<CloudMigrationPanel userId="user-a" repository={repository} />);

    expect(screen.getByText('1 个自选股池')).toBeInTheDocument();
    expect(screen.getByText('2 个自选标的')).toBeInTheDocument();
    expect(screen.getByText('1 个实际持仓')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导入云端' })).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: /确认把上述本地数据导入云端/ }));
    await user.click(screen.getByRole('button', { name: '导入云端' }));

    await waitFor(() => expect(repository.importLocalState).toHaveBeenCalledOnce());
  });

  it('records completion only after the server confirms the import', async () => {
    let resolveImport!: () => void;
    const repository = {
      importLocalState: vi.fn(() => new Promise<void>(resolve => { resolveImport = resolve; })),
    };
    const user = userEvent.setup();
    render(<CloudMigrationPanel userId="user-a" repository={repository} />);

    await user.click(screen.getByRole('checkbox', { name: /确认把上述本地数据导入云端/ }));
    await user.click(screen.getByRole('button', { name: '导入云端' }));
    expect(localStorage.getItem(cloudMigrationCompletionKey('user-a'))).toBeNull();

    resolveImport();
    expect(await screen.findByText('本地数据已安全导入云端')).toBeInTheDocument();
    expect(localStorage.getItem(cloudMigrationCompletionKey('user-a'))).toMatch(/^[a-f0-9]{64}$/);
  });
});
