import { describe, expect, it, vi } from 'vitest';
import { CloudSecuritiesRepository } from './cloud-securities-repository';

function client() {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-a' } }, error: null }) },
    from: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: 'transaction-a', error: null }),
  };
}

describe('CloudSecuritiesRepository trading', () => {
  it('maps a buy request to the authenticated atomic RPC payload', async () => {
    const service = client();
    const repository = new CloudSecuritiesRepository(service as never);

    await repository.executeBuy({
      alertId: 'alert-a', code: '000001', name: '平安银行', shares: 100, price: 10,
      groupId: 'core', groupName: '核心持仓', tradedAt: '2026-08-07T01:30:00.000Z',
    });

    expect(service.rpc).toHaveBeenCalledWith('execute_cloud_position_buy', {
      p_payload: {
        alert_id: 'alert-a', code: '000001', name: '平安银行', shares: 100, price: 10,
        group_source_id: 'core', group_name: '核心持仓', traded_at: '2026-08-07T01:30:00.000Z',
      },
    });
  });

  it('maps a partial sell request without accepting a caller supplied user id', async () => {
    const service = client();
    const repository = new CloudSecuritiesRepository(service as never);

    await repository.executeSell({
      alertId: 'alert-b', code: '000001', shares: 200, price: 12,
      tradedAt: '2026-08-08T02:00:00.000Z',
    });

    expect(service.rpc).toHaveBeenCalledWith('execute_cloud_position_sell', {
      p_payload: {
        alert_id: 'alert-b', code: '000001', shares: 200, price: 12,
        traded_at: '2026-08-08T02:00:00.000Z',
      },
    });
  });

  it('maps a manual watchlist buy without requiring a cloud signal alert', async () => {
    const service = client();
    const repository = new CloudSecuritiesRepository(service as never);

    await repository.executeManualBuy({
      operationId: 'manual-watchlist-000002-1', code: '000002', name: 'Vanke',
      shares: 100, price: 8.5, groupId: 'default', groupName: 'Default',
      tradedAt: '2026-08-11T02:00:00.000Z',
    });

    expect(service.rpc).toHaveBeenCalledWith('execute_cloud_manual_position_buy', {
      p_payload: {
        operation_id: 'manual-watchlist-000002-1', code: '000002', name: 'Vanke',
        shares: 100, price: 8.5, group_source_id: 'default', group_name: 'Default',
        traded_at: '2026-08-11T02:00:00.000Z',
      },
    });
  });

  it('maps manual sell and group changes to dedicated cloud RPCs', async () => {
    const service = client();
    const repository = new CloudSecuritiesRepository(service as never);

    await repository.executeManualSell({
      operationId: 'manual-sell-000001-1', code: '000001', shares: 100, price: 12,
      tradedAt: '2026-08-11T02:00:00.000Z',
    });
    await repository.movePositionGroup({
      code: '000001', groupId: 'core', groupName: 'Core',
      updatedAt: '2026-08-11T02:01:00.000Z',
    });

    expect(service.rpc).toHaveBeenNthCalledWith(1, 'execute_cloud_manual_position_sell', {
      p_payload: {
        operation_id: 'manual-sell-000001-1', code: '000001', shares: 100, price: 12,
        traded_at: '2026-08-11T02:00:00.000Z',
      },
    });
    expect(service.rpc).toHaveBeenNthCalledWith(2, 'move_cloud_position_group', {
      p_payload: {
        code: '000001', group_source_id: 'core', group_name: 'Core',
        updated_at: '2026-08-11T02:01:00.000Z',
      },
    });
  });
});
