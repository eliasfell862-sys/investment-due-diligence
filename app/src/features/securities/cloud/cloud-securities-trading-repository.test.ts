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
});
