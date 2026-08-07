import type { SupabaseClient } from '@supabase/supabase-js';
import { CloudSecuritiesRepository as RepositoryBase } from './cloud-securities-repository-base';

export { CloudSecuritiesError } from './cloud-securities-repository-base';

export interface CloudPositionBuyInput {
  alertId: string; code: string; name: string; shares: number; price: number;
  groupId: string; groupName: string; tradedAt: string;
}

export interface CloudPositionSellInput {
  alertId: string; code: string; shares: number; price: number; tradedAt: string;
}

export class CloudSecuritiesRepository extends RepositoryBase {
  override async executeBuy(input: Record<string, unknown> | CloudPositionBuyInput): Promise<void> {
    const trade = input as unknown as CloudPositionBuyInput;
    await super.executeBuy({
      alert_id: trade.alertId, code: trade.code, name: trade.name,
      shares: trade.shares, price: trade.price,
      group_source_id: trade.groupId, group_name: trade.groupName, traded_at: trade.tradedAt,
    });
  }

  override async executeSell(input: Record<string, unknown> | CloudPositionSellInput): Promise<void> {
    const trade = input as unknown as CloudPositionSellInput;
    await super.executeSell({
      alert_id: trade.alertId, code: trade.code, shares: trade.shares,
      price: trade.price, traded_at: trade.tradedAt,
    });
  }
}

export function createCloudSecuritiesRepository(client?: SupabaseClient): CloudSecuritiesRepository {
  return new CloudSecuritiesRepository(client as never);
}
